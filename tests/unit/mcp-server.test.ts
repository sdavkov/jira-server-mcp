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
    getComments: vi.fn(),
    getComment: vi.fn(),
    getTransitions: vi.fn(),
    previewTransition: vi.fn(),
    confirmTransition: vi.fn(),
    previewComment: vi.fn(),
    confirmComment: vi.fn(),
    getAttachments: vi.fn(),
    downloadAttachment: vi.fn(),
    getLinkedIssues: vi.fn(),
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
  it("exposes attachment and linked-issue tools as read-only operations", async () => {
    const client = await connect(serviceStub());

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual([
      "jira_get_current_user",
      "jira_search_issues",
      "jira_get_issue",
      "jira_get_comments",
      "jira_get_comment",
      "jira_get_transitions",
      "jira_get_attachments",
      "jira_get_attachment",
      "jira_get_linked_issues",
      "jira_transition_issue",
      "jira_add_comment",
    ]);
    expect(
      tools.slice(0, 9).every((tool) => tool.annotations?.readOnlyHint),
    ).toBe(true);
    expect(tools[9]?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    });
  });

  it("reads paginated comments without requesting confirmation", async () => {
    const service = serviceStub();
    vi.mocked(service.getComments).mockResolvedValue({
      startAt: 0,
      maxResults: 50,
      total: 1,
      comments: [
        {
          id: "9001",
          body: "Existing discussion",
          author: { name: "user", displayName: "User" },
        },
      ],
    });
    const client = await connect(service);

    const result = await client.callTool({
      name: "jira_get_comments",
      arguments: { issueKey: "TEST-1" },
    });

    expect(result.isError).not.toBe(true);
    expect(service.getComments).toHaveBeenCalledWith("TEST-1", {
      startAt: 0,
      maxResults: 50,
      orderBy: "created",
    });
    expect(result.structuredContent).toMatchObject({
      total: 1,
      comments: [{ id: "9001", body: "Existing discussion" }],
    });
  });

  it("reads one existing comment by issue key and comment ID", async () => {
    const service = serviceStub();
    vi.mocked(service.getComment).mockResolvedValue({
      id: "9001",
      body: "Existing discussion",
      author: { name: "user", displayName: "User" },
    });
    const client = await connect(service);

    const result = await client.callTool({
      name: "jira_get_comment",
      arguments: { issueKey: "TEST-1", commentId: "9001" },
    });

    expect(result.isError).not.toBe(true);
    expect(service.getComment).toHaveBeenCalledWith("TEST-1", "9001");
    expect(result.structuredContent).toMatchObject({
      id: "9001",
      body: "Existing discussion",
    });
  });

  it("returns downloaded PNG bytes as MCP image content", async () => {
    const service = serviceStub();
    vi.mocked(service.downloadAttachment).mockResolvedValue({
      attachment: {
        id: "10001",
        filename: "screen.png",
        size: 4,
        mimeType: "image/png",
        contentUrl:
          "https://jira.onlinepatent.ru/secure/attachment/10001/screen.png",
      },
      content: new Uint8Array([137, 80, 78, 71]),
    });
    const client = await connect(service);

    const result = await client.callTool({
      name: "jira_get_attachment",
      arguments: { attachmentId: "10001" },
    });

    expect(result.isError).not.toBe(true);
    expect(result.content).toContainEqual({
      type: "image",
      data: Buffer.from([137, 80, 78, 71]).toString("base64"),
      mimeType: "image/png",
    });
    expect(result.structuredContent).toMatchObject({
      attachment: { id: "10001", filename: "screen.png" },
    });
  });

  it("returns non-image attachments as embedded MCP resources", async () => {
    const service = serviceStub();
    vi.mocked(service.downloadAttachment).mockResolvedValue({
      attachment: {
        id: "10002",
        filename: "report.pdf",
        size: 3,
        mimeType: "application/pdf",
        contentUrl:
          "https://jira.onlinepatent.ru/secure/attachment/10002/report.pdf",
      },
      content: new Uint8Array([1, 2, 3]),
    });
    const client = await connect(service);

    const result = await client.callTool({
      name: "jira_get_attachment",
      arguments: { attachmentId: "10002" },
    });

    expect(result.content).toContainEqual({
      type: "resource",
      resource: {
        uri: "jira-attachment:///10002/report.pdf",
        blob: Buffer.from([1, 2, 3]).toString("base64"),
        mimeType: "application/pdf",
      },
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
