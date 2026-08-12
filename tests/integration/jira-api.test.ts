import { describe, expect, it, vi } from "vitest";

import { BasicAuthProvider } from "../../src/jira/auth-provider.js";
import { JiraApi } from "../../src/jira/jira-api.js";
import { JiraHttpClient } from "../../src/jira/jira-http-client.js";

function createApi(fetcher: typeof fetch): JiraApi {
  return new JiraApi(
    new JiraHttpClient({
      baseUrl: "https://jira.onlinepatent.ru",
      auth: new BasicAuthProvider("user", "secret"),
      timeoutMs: 1_000,
      fetcher,
    }),
  );
}

function parseJsonBody(body: BodyInit | null | undefined): unknown {
  if (typeof body !== "string") throw new Error("Expected a JSON request body");
  return JSON.parse(body) as unknown;
}

describe("JiraApi", () => {
  it("uses POST search so long JQL is not constrained by URL length", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ startAt: 0, maxResults: 50, total: 0, issues: [] }),
      );
    const api = createApi(fetcher);

    await api.searchIssues({
      jql: "assignee = currentUser() ORDER BY updated DESC",
      startAt: 0,
      maxResults: 50,
      fields: ["summary", "status"],
    });

    const [, init] = fetcher.mock.calls[0] ?? [];
    expect(init?.method).toBe("POST");
    expect(parseJsonBody(init?.body)).toEqual({
      jql: "assignee = currentUser() ORDER BY updated DESC",
      startAt: 0,
      maxResults: 50,
      fields: ["summary", "status"],
      validateQuery: true,
    });
  });

  it("requests transition field metadata and posts only the selected transition", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ transitions: [] }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const api = createApi(fetcher);

    await api.getTransitions("TEST-1");
    await api.transitionIssue("TEST-1", "31", {
      resolution: { name: "Fixed" },
    });

    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://jira.onlinepatent.ru/rest/api/2/issue/TEST-1/transitions?expand=transitions.fields",
    );
    expect(parseJsonBody(fetcher.mock.calls[1]?.[1]?.body)).toEqual({
      transition: { id: "31" },
      fields: { resolution: { name: "Fixed" } },
    });
  });

  it("verifies comments through the specific comment endpoint", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ id: "9001", body: "Comment" }));
    const api = createApi(fetcher);

    await api.getComment("TEST-1", "9001");

    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://jira.onlinepatent.ru/rest/api/2/issue/TEST-1/comment/9001",
    );
  });
});
