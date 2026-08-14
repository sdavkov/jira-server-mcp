export type JiraUser = {
  readonly name: string;
  readonly key?: string;
  readonly displayName: string;
  readonly emailAddress?: string;
  readonly active: boolean;
  readonly timeZone?: string;
};

export type JiraStatus = {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly statusCategory?: {
    readonly id: number;
    readonly key: string;
    readonly name: string;
  };
};

export type JiraIssue = {
  readonly id: string;
  readonly key: string;
  readonly fields: {
    readonly summary: string;
    readonly status: JiraStatus;
    readonly description?: string | null;
    readonly assignee?: JiraUser | null;
    readonly reporter?: JiraUser | null;
    readonly priority?: { readonly id: string; readonly name: string } | null;
    readonly issuetype?: { readonly id: string; readonly name: string };
    readonly project?: {
      readonly id: string;
      readonly key: string;
      readonly name: string;
    };
    readonly created?: string;
    readonly updated?: string;
    readonly labels?: readonly string[];
    readonly [field: string]: unknown;
  };
};

export type TransitionField = {
  readonly required: boolean;
  readonly name: string;
  readonly hasDefaultValue?: boolean;
  readonly schema?: Readonly<Record<string, unknown>>;
  readonly operations?: readonly string[];
  readonly allowedValues?: readonly unknown[];
};

export type JiraTransition = {
  readonly id: string;
  readonly name: string;
  readonly to: JiraStatus;
  readonly fields: Readonly<Record<string, TransitionField>>;
};

export type JiraComment = {
  readonly id: string;
  readonly body: string;
  readonly renderedBody?: string;
  readonly author?: Pick<JiraUser, "name" | "displayName">;
  readonly updateAuthor?: Pick<JiraUser, "name" | "displayName">;
  readonly created?: string;
  readonly updated?: string;
  readonly visibility?: {
    readonly type: "group" | "role";
    readonly value: string;
  };
};

export type JiraCommentsRequest = {
  readonly startAt: number;
  readonly maxResults: number;
  readonly orderBy: "created" | "-created";
};

export type JiraCommentsPage = {
  readonly startAt: number;
  readonly maxResults: number;
  readonly total: number;
  readonly comments: readonly JiraComment[];
};

export type JiraAttachment = {
  readonly id: string;
  readonly filename: string;
  readonly size: number;
  readonly mimeType: string;
  readonly author?: Pick<JiraUser, "name" | "displayName">;
  readonly created?: string;
  readonly contentUrl: string;
  readonly thumbnailUrl?: string;
};

export type JiraAttachmentDownload = {
  readonly attachment: JiraAttachment;
  readonly content: Uint8Array;
};

export type JiraLinkedIssue = {
  readonly id: string;
  readonly key: string;
  readonly fields: {
    readonly summary?: string;
    readonly status?: JiraStatus;
    readonly priority?: { readonly id: string; readonly name: string } | null;
    readonly issuetype?: { readonly id: string; readonly name: string };
  };
};

export type JiraIssueLink = {
  readonly id: string;
  readonly type: {
    readonly id: string;
    readonly name: string;
  };
  readonly direction: "inward" | "outward";
  readonly relationship: string;
  readonly issue: JiraLinkedIssue;
};

export type JiraSearchRequest = {
  readonly jql: string;
  readonly startAt: number;
  readonly maxResults: number;
  readonly fields: readonly string[];
};

export type JiraSearchResult = {
  readonly startAt: number;
  readonly maxResults: number;
  readonly total: number;
  readonly issues: readonly JiraIssue[];
  readonly warningMessages?: readonly string[];
};

export interface JiraGateway {
  getCurrentUser(): Promise<JiraUser>;
  searchIssues(request: JiraSearchRequest): Promise<JiraSearchResult>;
  getIssue(issueKey: string): Promise<JiraIssue>;
  getTransitions(issueKey: string): Promise<readonly JiraTransition[]>;
  transitionIssue(
    issueKey: string,
    transitionId: string,
    fields: Readonly<Record<string, unknown>>,
  ): Promise<void>;
  addComment(issueKey: string, body: string): Promise<JiraComment>;
  getComments(
    issueKey: string,
    request: JiraCommentsRequest,
  ): Promise<JiraCommentsPage>;
  getComment(issueKey: string, commentId: string): Promise<JiraComment>;
  getAttachments(issueKey: string): Promise<readonly JiraAttachment[]>;
  downloadAttachment(attachmentId: string): Promise<JiraAttachmentDownload>;
  getLinkedIssues(issueKey: string): Promise<readonly JiraIssueLink[]>;
}
