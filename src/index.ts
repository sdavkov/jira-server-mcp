#!/usr/bin/env node

import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { PreviewStore } from "./confirmation/preview-store.js";
import { configPathFromArgs, loadConfig } from "./config/config-loader.js";
import { BasicAuthProvider } from "./jira/auth-provider.js";
import { JiraApi } from "./jira/jira-api.js";
import { JiraHttpClient } from "./jira/jira-http-client.js";
import { JiraService } from "./jira/jira-service.js";
import { createMcpServer } from "./server/create-server.js";

async function main(): Promise<void> {
  const configPath = configPathFromArgs(process.argv.slice(2));
  const config = await loadConfig(configPath);
  const auth = new BasicAuthProvider(
    config.jira.auth.username,
    config.jira.auth.password,
  );
  const api = new JiraApi(
    new JiraHttpClient({
      baseUrl: config.jira.baseUrl,
      auth,
      timeoutMs: config.jira.timeoutMs,
    }),
  );
  const previews = new PreviewStore({ ttlMs: config.jira.previewTtlMs });
  const service = new JiraService(api, previews);
  const handle = serveStdio(() => createMcpServer(service), {
    onerror: (error) =>
      console.error(`Jira MCP transport error: ${error.message}`),
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => void handle.close());
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Unknown startup error";
  console.error(`Jira MCP failed to start: ${message}`);
  process.exitCode = 1;
});
