import type { JiraHttpClient } from "./jira-http-client.js";
import type {
  JiraAttachment,
  JiraAttachmentDownload,
  JiraComment,
  JiraGateway,
  JiraIssue,
  JiraIssueLink,
  JiraLinkedIssue,
  JiraSearchRequest,
  JiraSearchResult,
  JiraTransition,
  JiraUser,
} from "./jira-types.js";
import { JiraError } from "./jira-errors.js";

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
  public constructor(
    private readonly http: JiraHttpClient,
    private readonly maxAttachmentBytes: number,
  ) {}

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

  public async getAttachments(
    issueKey: string,
  ): Promise<readonly JiraAttachment[]> {
    const response = await this.getIssueFields<{
      readonly attachment?: readonly JiraAttachmentResponse[];
    }>(issueKey, "attachment");
    return (response.attachment ?? []).map((attachment) =>
      normalizeAttachment(attachment),
    );
  }

  public async downloadAttachment(
    attachmentId: string,
  ): Promise<JiraAttachmentDownload> {
    const response = await this.http.get<JiraAttachmentResponse>(
      `/rest/api/2/attachment/${encodeSegment(attachmentId)}`,
    );
    const attachment = normalizeAttachment(response, attachmentId);
    const content = await this.http.getAttachmentContent(
      attachment.contentUrl,
      {
        expectedMimeType: attachment.mimeType,
        maxBytes: this.maxAttachmentBytes,
      },
    );
    return { attachment, content };
  }

  public async getLinkedIssues(
    issueKey: string,
  ): Promise<readonly JiraIssueLink[]> {
    const response = await this.getIssueFields<{
      readonly issuelinks?: readonly JiraIssueLinkResponse[];
    }>(issueKey, "issuelinks");
    return (response.issuelinks ?? []).map(normalizeIssueLink);
  }

  private async getIssueFields<T>(
    issueKey: string,
    fields: string,
  ): Promise<T> {
    const response = await this.http.get<{ readonly fields: T }>(
      `/rest/api/2/issue/${encodeSegment(issueKey)}`,
      { query: { fields } },
    );
    return response.fields;
  }
}

type JiraAttachmentResponse = {
  readonly id?: string;
  readonly self?: string;
  readonly filename: string;
  readonly size: number;
  readonly mimeType: string;
  readonly author?: JiraAttachment["author"];
  readonly created?: string;
  readonly content: string;
  readonly thumbnail?: string;
};

type JiraIssueLinkResponse = {
  readonly id: string;
  readonly type: {
    readonly id: string;
    readonly name: string;
    readonly inward: string;
    readonly outward: string;
  };
  readonly inwardIssue?: JiraLinkedIssue;
  readonly outwardIssue?: JiraLinkedIssue;
};

function normalizeAttachment(
  response: JiraAttachmentResponse,
  fallbackId?: string,
): JiraAttachment {
  const id = response.id ?? fallbackId ?? attachmentIdFromSelf(response.self);
  if (!id) {
    throw new JiraError(
      "unexpected_response",
      "Jira attachment metadata does not contain an attachment ID",
    );
  }
  return {
    id,
    filename: response.filename,
    size: response.size,
    mimeType: response.mimeType,
    contentUrl: response.content,
    ...(response.author ? { author: response.author } : {}),
    ...(response.created ? { created: response.created } : {}),
    ...(response.thumbnail ? { thumbnailUrl: response.thumbnail } : {}),
  };
}

function attachmentIdFromSelf(self: string | undefined): string | undefined {
  if (!self) return undefined;
  const match = /\/(?:attachment|attachments)\/(\d+)\/?$/u.exec(
    new URL(self).pathname,
  );
  return match?.[1];
}

function normalizeIssueLink(response: JiraIssueLinkResponse): JiraIssueLink {
  if (response.outwardIssue) {
    return issueLink(response, "outward", response.outwardIssue);
  }
  if (response.inwardIssue) {
    return issueLink(response, "inward", response.inwardIssue);
  }
  throw new JiraError(
    "unexpected_response",
    "Jira issue link does not contain a linked issue",
  );
}

function issueLink(
  response: JiraIssueLinkResponse,
  direction: JiraIssueLink["direction"],
  issue: JiraLinkedIssue,
): JiraIssueLink {
  return {
    id: response.id,
    type: { id: response.type.id, name: response.type.name },
    direction,
    relationship: response.type[direction],
    issue,
  };
}

function encodeSegment(value: string): string {
  return encodeURIComponent(value);
}
