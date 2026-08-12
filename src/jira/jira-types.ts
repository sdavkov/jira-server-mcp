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
  readonly author?: Pick<JiraUser, "name" | "displayName">;
  readonly created?: string;
  readonly updated?: string;
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
  getComment(issueKey: string, commentId: string): Promise<JiraComment>;
}
