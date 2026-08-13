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
    1_024,
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

  it("lists attachments with stable IDs derived from Jira metadata", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        fields: {
          attachment: [
            {
              self: "https://jira.onlinepatent.ru/rest/api/2/attachment/10001",
              filename: "screen.png",
              size: 4,
              mimeType: "image/png",
              content:
                "https://jira.onlinepatent.ru/secure/attachment/10001/screen.png",
            },
          ],
        },
      }),
    );
    const api = createApi(fetcher);

    const attachments = await api.getAttachments("TEST-1");

    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://jira.onlinepatent.ru/rest/api/2/issue/TEST-1?fields=attachment",
    );
    expect(attachments).toEqual([
      expect.objectContaining({
        id: "10001",
        filename: "screen.png",
        mimeType: "image/png",
      }),
    ]);
  });

  it("downloads the exact attachment URI returned by Jira metadata", async () => {
    const contentUrl =
      "https://jira.onlinepatent.ru/secure/attachment/10001/screen.png";
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          self: "https://jira.onlinepatent.ru/rest/api/2/attachment/10001",
          filename: "screen.png",
          size: 4,
          mimeType: "image/png",
          content: contentUrl,
        }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([137, 80, 78, 71]), {
          headers: { "content-type": "image/png" },
        }),
      );
    const api = createApi(fetcher);

    const download = await api.downloadAttachment("10001");

    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://jira.onlinepatent.ru/rest/api/2/attachment/10001",
    );
    expect(fetcher.mock.calls[1]?.[0]).toBe(contentUrl);
    expect(download.attachment).toMatchObject({
      id: "10001",
      filename: "screen.png",
    });
    expect(download.content).toEqual(new Uint8Array([137, 80, 78, 71]));
  });

  it("normalizes inward and outward linked Jira issues", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        fields: {
          issuelinks: [
            {
              id: "20001",
              type: {
                id: "10000",
                name: "Blocks",
                inward: "is blocked by",
                outward: "blocks",
              },
              outwardIssue: {
                id: "101",
                key: "TEST-2",
                fields: {
                  summary: "Dependency",
                  status: { id: "1", name: "Open" },
                },
              },
            },
            {
              id: "20002",
              type: {
                id: "10000",
                name: "Blocks",
                inward: "is blocked by",
                outward: "blocks",
              },
              inwardIssue: {
                id: "102",
                key: "TEST-3",
                fields: {
                  summary: "Blocker",
                  status: { id: "3", name: "In Progress" },
                },
              },
            },
          ],
        },
      }),
    );
    const api = createApi(fetcher);

    const links = await api.getLinkedIssues("TEST-1");

    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://jira.onlinepatent.ru/rest/api/2/issue/TEST-1?fields=issuelinks",
    );
    expect(links).toHaveLength(2);
    expect(links[0]).toMatchObject({
      id: "20001",
      direction: "outward",
      relationship: "blocks",
      issue: { key: "TEST-2" },
    });
    expect(links[1]).toMatchObject({
      id: "20002",
      direction: "inward",
      relationship: "is blocked by",
      issue: { key: "TEST-3" },
    });
  });
});
