import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { AppConfigSchema, type AppConfig } from "./config-schema.js";

export class ConfigError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ConfigError";
  }
}

export function defaultConfigPath(): string {
  return join(homedir(), ".config", "jira-mcp", "config.json");
}

export function configPathFromArgs(args: readonly string[]): string {
  const position = args.indexOf("--config");
  if (position === -1) return defaultConfigPath();
  const candidate = args[position + 1];
  if (!candidate) throw new ConfigError("--config requires a file path");
  return resolve(candidate);
}

export async function loadConfig(path: string): Promise<AppConfig> {
  await assertPrivateRegularFile(path);
  const source = await readFile(path, "utf8").catch((error: unknown) => {
    throw new ConfigError(`Cannot read MCP configuration file: ${path}`, {
      cause: error,
    });
  });
  const parsed = parseJson(source, path);
  const result = AppConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new ConfigError(`Invalid MCP configuration: ${result.error.message}`);
  }
  return result.data;
}

async function assertPrivateRegularFile(path: string): Promise<void> {
  const details = await stat(path).catch((error: unknown) => {
    throw new ConfigError(`MCP configuration file not found: ${path}`, {
      cause: error,
    });
  });
  if (!details.isFile())
    throw new ConfigError(`Configuration is not a file: ${path}`);
  if ((details.mode & 0o077) !== 0) {
    throw new ConfigError(
      `Configuration must be private; run: chmod 600 ${path}`,
    );
  }
}

function parseJson(source: string, path: string): unknown {
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    throw new ConfigError(`Configuration is not valid JSON: ${path}`, {
      cause: error,
    });
  }
}
