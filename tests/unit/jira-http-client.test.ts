import { describe, expect, it, vi } from "vitest";

import { BasicAuthProvider } from "../../src/jira/auth-provider.js";
import { JiraError } from "../../src/jira/jira-errors.js";
import { JiraHttpClient } from "../../src/jira/jira-http-client.js";

describe("JiraHttpClient", () => {
  it("sends Basic Auth preemptively and refuses automatic redirects", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ name: "user" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new JiraHttpClient({
      baseUrl: "https://jira.onlinepatent.ru",
      auth: new BasicAuthProvider("user", "secret"),
      timeoutMs: 1_000,
      fetcher,
    });

    await client.get("/rest/api/2/myself");

    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("https://jira.onlinepatent.ru/rest/api/2/myself");
    expect(init?.redirect).toBe("manual");
    expect(new Headers(init?.headers).get("authorization")).toBe(
      `Basic ${Buffer.from("user:secret").toString("base64")}`,
    );
  });

  it("maps Jira CAPTCHA authentication failures to a safe error", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("", {
        status: 401,
        headers: { "x-seraph-loginreason": "AUTHENTICATION_DENIED" },
      }),
    );
    const client = new JiraHttpClient({
      baseUrl: "https://jira.onlinepatent.ru",
      auth: new BasicAuthProvider("user", "do-not-leak"),
      timeoutMs: 1_000,
      fetcher,
    });

    const error: unknown = await client
      .get("/rest/api/2/myself")
      .catch((reason: unknown): unknown => reason);

    expect(error).toBeInstanceOf(JiraError);
    if (!(error instanceof JiraError)) throw error;
    expect(error.code).toBe("captcha_blocked");
    expect(error.message).not.toContain("do-not-leak");
  });

  it("does not accept absolute or non-Jira API request paths", async () => {
    const client = new JiraHttpClient({
      baseUrl: "https://jira.onlinepatent.ru",
      auth: new BasicAuthProvider("user", "secret"),
      timeoutMs: 1_000,
      fetcher: vi.fn<typeof fetch>(),
    });

    await expect(client.get("https://attacker.invalid/")).rejects.toThrow(
      /relative Jira REST API path/i,
    );
    await expect(client.get("/plugins/servlet/admin")).rejects.toThrow(
      /relative Jira REST API path/i,
    );
  });

  it.each([
    [401, "authentication_failed"],
    [403, "permission_denied"],
    [404, "not_found_or_hidden"],
    [502, "jira_unavailable"],
  ] as const)("maps HTTP %i to %s", async (status, expectedCode) => {
    const client = new JiraHttpClient({
      baseUrl: "https://jira.onlinepatent.ru",
      auth: new BasicAuthProvider("user", "secret"),
      timeoutMs: 1_000,
      fetcher: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("", { status })),
    });

    const error: unknown = await client
      .get("/rest/api/2/myself")
      .catch((reason: unknown): unknown => reason);

    expect(error).toBeInstanceOf(JiraError);
    if (!(error instanceof JiraError)) throw error;
    expect(error.code).toBe(expectedCode);
  });

  it("keeps a Jira context path when constructing requests", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}));
    const client = new JiraHttpClient({
      baseUrl: "https://example.test/jira",
      auth: new BasicAuthProvider("user", "secret"),
      timeoutMs: 1_000,
      fetcher,
    });

    await client.get("/rest/api/2/myself");

    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://example.test/jira/rest/api/2/myself",
    );
  });

  it("maps malformed success payloads to an unexpected response error", async () => {
    const client = new JiraHttpClient({
      baseUrl: "https://jira.onlinepatent.ru",
      auth: new BasicAuthProvider("user", "secret"),
      timeoutMs: 1_000,
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        new Response("not-json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    });

    const error: unknown = await client
      .get("/rest/api/2/myself")
      .catch((reason: unknown): unknown => reason);

    expect(error).toBeInstanceOf(JiraError);
    if (!(error instanceof JiraError)) throw error;
    expect(error.code).toBe("unexpected_response");
  });
});
