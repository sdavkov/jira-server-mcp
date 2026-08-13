import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];
const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("stdio entrypoint", () => {
  it("initializes and lists tools without writing non-protocol output to stdout", async () => {
    const directory = await mkdtemp(join(tmpdir(), "jira-mcp-stdio-"));
    temporaryDirectories.push(directory);
    const configPath = join(directory, "config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        jira: {
          baseUrl: "https://jira.onlinepatent.ru",
          auth: { type: "basic", username: "user", password: "secret" },
        },
      }),
      { mode: 0o600 },
    );
    await chmod(configPath, 0o600);
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve("build/index.js"), "--config", configPath],
      stderr: "pipe",
    });
    const client = new Client({ name: "stdio-test", version: "1.0.0" });
    clients.push(client);

    await client.connect(transport);
    const { tools } = await client.listTools();

    expect(tools).toHaveLength(9);
    expect(tools.map((tool) => tool.name)).toContain("jira_get_current_user");
  });
});
