import type { AuthProvider } from "./auth-provider.js";
import { JiraError, type JiraErrorCode } from "./jira-errors.js";

type Fetcher = typeof fetch;

type JiraHttpClientOptions = {
  readonly baseUrl: string;
  readonly auth: AuthProvider;
  readonly timeoutMs: number;
  readonly fetcher?: Fetcher;
};

type RequestOptions = {
  readonly body?: unknown;
  readonly expectedStatuses?: readonly number[];
  readonly query?: Readonly<
    Record<string, string | number | boolean | undefined>
  >;
};

export class JiraHttpClient {
  private readonly options: Required<JiraHttpClientOptions>;

  public constructor(options: JiraHttpClientOptions) {
    this.options = { ...options, fetcher: options.fetcher ?? fetch };
  }

  public get<T = unknown>(
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    return this.request<T>("GET", path, options);
  }

  public post<T = unknown>(
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    return this.request<T>("POST", path, options);
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    options: RequestOptions,
  ): Promise<T> {
    const url = this.buildUrl(path, options.query);
    const headers = new Headers({ accept: "application/json" });
    this.options.auth.apply(headers);
    const init: RequestInit = {
      method,
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(this.options.timeoutMs),
    };
    if (options.body !== undefined) {
      headers.set("content-type", "application/json");
      init.body = JSON.stringify(options.body);
    }
    const response = await this.fetch(url, init);
    const expected = options.expectedStatuses ?? [200];
    if (!expected.includes(response.status))
      await throwJiraResponseError(response);
    if (response.status === 204) return undefined as T;
    try {
      return (await response.json()) as T;
    } catch (error) {
      throw new JiraError(
        "unexpected_response",
        "Jira returned an invalid JSON response",
        { status: response.status, cause: error },
      );
    }
  }

  private buildUrl(path: string, query: RequestOptions["query"]): string {
    if (!/^\/rest\/api\/2(?:\/|$)/u.test(path)) {
      throw new JiraError(
        "invalid_request",
        "Expected a relative Jira REST API path under /rest/api/2",
      );
    }
    const url = new URL(`${this.options.baseUrl}${path}`);
    for (const [name, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(name, String(value));
    }
    return url.toString();
  }

  private async fetch(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.options.fetcher(url, init);
    } catch (error) {
      if (isTimeout(error)) {
        throw new JiraError("request_timeout", "Jira request timed out", {
          cause: error,
        });
      }
      throw new JiraError("network_error", "Could not connect to Jira", {
        cause: error,
      });
    }
  }
}

async function throwJiraResponseError(response: Response): Promise<never> {
  const details = await readSafeErrorDetails(response);
  const status = response.status;
  if (
    status === 401 &&
    response.headers.get("x-seraph-loginreason") === "AUTHENTICATION_DENIED"
  ) {
    throw new JiraError(
      "captcha_blocked",
      "Jira authentication is blocked by CAPTCHA",
      {
        status,
        details,
      },
    );
  }
  const [code, message] = errorForStatus(status);
  throw new JiraError(code, message, { status, details });
}

function errorForStatus(status: number): readonly [JiraErrorCode, string] {
  if (status === 400) return ["invalid_request", "Jira rejected the request"];
  if (status === 401)
    return ["authentication_failed", "Jira authentication failed"];
  if (status === 403) return ["permission_denied", "Jira permission denied"];
  if (status === 404)
    return ["not_found_or_hidden", "Jira item was not found or is hidden"];
  if (status >= 500)
    return ["jira_unavailable", "Jira is temporarily unavailable"];
  return ["unexpected_response", `Unexpected Jira response status ${status}`];
}

async function readSafeErrorDetails(
  response: Response,
): Promise<readonly string[]> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return [];
  const body = (await response.json().catch(() => undefined)) as
    | { errorMessages?: unknown; errors?: unknown }
    | undefined;
  const messages = Array.isArray(body?.errorMessages)
    ? body.errorMessages.filter(
        (item): item is string => typeof item === "string",
      )
    : [];
  const fields = isRecord(body?.errors)
    ? Object.values(body.errors).filter(
        (item): item is string => typeof item === "string",
      )
    : [];
  return [...messages, ...fields].slice(0, 20);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimeout(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    ["AbortError", "TimeoutError"].includes(error.name)
  );
}
