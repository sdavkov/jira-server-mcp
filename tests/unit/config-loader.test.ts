import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadConfig } from "../../src/config/config-loader.js";

const temporaryDirectories: string[] = [];

async function createConfig(contents: unknown, mode = 0o600): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "jira-mcp-config-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "config.json");
  await writeFile(path, JSON.stringify(contents), { mode });
  await chmod(path, mode);
  return path;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("loadConfig", () => {
  it("loads a valid HTTPS Jira Basic Auth configuration", async () => {
    const path = await createConfig({
      jira: {
        baseUrl: "https://jira.onlinepatent.ru/",
        auth: { type: "basic", username: "user", password: "secret" },
      },
    });

    const config = await loadConfig(path);

    expect(config.jira.baseUrl).toBe("https://jira.onlinepatent.ru");
    expect(config.jira.timeoutMs).toBe(15_000);
    expect(config.jira.maxAttachmentBytes).toBe(10_485_760);
    expect(config.jira.auth.username).toBe("user");
  });

  it("rejects a configuration readable by group or other users", async () => {
    const path = await createConfig(
      {
        jira: {
          baseUrl: "https://jira.onlinepatent.ru",
          auth: { type: "basic", username: "user", password: "do-not-leak" },
        },
      },
      0o644,
    );

    await expect(loadConfig(path)).rejects.toThrow(/chmod 600/i);
    await expect(loadConfig(path)).rejects.not.toThrow(/do-not-leak/i);
  });

  it("rejects non-HTTPS Jira addresses", async () => {
    const path = await createConfig({
      jira: {
        baseUrl: "http://jira.onlinepatent.ru",
        auth: { type: "basic", username: "user", password: "secret" },
      },
    });

    await expect(loadConfig(path)).rejects.toThrow(/HTTPS/i);
  });
});
