import type { JiraHttpClient } from "./jira-http-client.js";
import type {
  JiraComment,
  JiraGateway,
  JiraIssue,
  JiraSearchRequest,
  JiraSearchResult,
  JiraTransition,
  JiraUser,
} from "./jira-types.js";

const ISSUE_FIELDS = [
  "summary",
  "status",
  "description",
  "assignee",
  "reporter",
  "priority",
  "issuetype",
  "project",
  "created",
  "updated",
  "labels",
] as const;

export class JiraApi implements JiraGateway {
  public constructor(private readonly http: JiraHttpClient) {}

  public getCurrentUser(): Promise<JiraUser> {
    return this.http.get("/rest/api/2/myself");
  }

  public searchIssues(request: JiraSearchRequest): Promise<JiraSearchResult> {
    return this.http.post("/rest/api/2/search", {
      body: { ...request, validateQuery: true },
    });
  }

  public getIssue(issueKey: string): Promise<JiraIssue> {
    return this.http.get(`/rest/api/2/issue/${encodeSegment(issueKey)}`, {
      query: { fields: ISSUE_FIELDS.join(",") },
    });
  }

  public async getTransitions(
    issueKey: string,
  ): Promise<readonly JiraTransition[]> {
    const response = await this.http.get<{
      readonly transitions: readonly JiraTransition[];
    }>(`/rest/api/2/issue/${encodeSegment(issueKey)}/transitions`, {
      query: { expand: "transitions.fields" },
    });
    return response.transitions;
  }

  public transitionIssue(
    issueKey: string,
    transitionId: string,
    fields: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    return this.http.post(
      `/rest/api/2/issue/${encodeSegment(issueKey)}/transitions`,
      {
        body: { transition: { id: transitionId }, fields },
        expectedStatuses: [204],
      },
    );
  }

  public addComment(issueKey: string, body: string): Promise<JiraComment> {
    return this.http.post(
      `/rest/api/2/issue/${encodeSegment(issueKey)}/comment`,
      {
        body: { body },
        expectedStatuses: [201],
      },
    );
  }

  public getComment(issueKey: string, commentId: string): Promise<JiraComment> {
    return this.http.get(
      `/rest/api/2/issue/${encodeSegment(issueKey)}/comment/${encodeSegment(commentId)}`,
    );
  }
}

function encodeSegment(value: string): string {
  return encodeURIComponent(value);
}
