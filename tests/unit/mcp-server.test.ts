import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createMcpServer } from "../../src/server/create-server.js";
import type { JiraService } from "../../src/jira/jira-service.js";

const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

function serviceStub(): JiraService {
  return {
    getCurrentUser: vi.fn().mockResolvedValue({
      name: "user",
      displayName: "Test User",
      active: true,
    }),
    searchIssues: vi.fn(),
    getIssue: vi.fn(),
    getTransitions: vi.fn(),
    previewTransition: vi.fn(),
    confirmTransition: vi.fn(),
    previewComment: vi.fn(),
    confirmComment: vi.fn(),
  } as unknown as JiraService;
}

async function connect(service: JiraService): Promise<Client> {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const server = createMcpServer(service);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  clients.push(client);
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return client;
}

describe("createMcpServer", () => {
  it("exposes exactly the six Jira tools with safe mutation annotations", async () => {
    const client = await connect(serviceStub());

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual([
      "jira_get_current_user",
      "jira_search_issues",
      "jira_get_issue",
      "jira_get_transitions",
      "jira_transition_issue",
      "jira_add_comment",
    ]);
    expect(
      tools.slice(0, 4).every((tool) => tool.annotations?.readOnlyHint),
    ).toBe(true);
    expect(tools[4]?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    });
  });

  it("returns structured user data from a read-only tool", async () => {
    const client = await connect(serviceStub());

    const result = await client.callTool({
      name: "jira_get_current_user",
      arguments: {},
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      name: "user",
      displayName: "Test User",
    });
  });

  it("refuses a mutation with confirm=true unless a preview token is supplied", async () => {
    const service = serviceStub();
    const client = await connect(service);

    const result = await client.callTool({
      name: "jira_add_comment",
      arguments: { confirm: true },
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.structuredContent)).toMatch(/previewToken/i);
    expect(service.confirmComment).not.toHaveBeenCalled();
  });
});
