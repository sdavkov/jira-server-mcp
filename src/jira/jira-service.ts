import {
  PreviewTokenError,
  type PendingComment,
  type PendingOperation,
  type PendingTransition,
  type PreviewStore,
} from "../confirmation/preview-store.js";
import type {
  JiraAttachment,
  JiraAttachmentDownload,
  JiraComment,
  JiraGateway,
  JiraIssue,
  JiraIssueLink,
  JiraSearchRequest,
  JiraSearchResult,
  JiraTransition,
  JiraUser,
} from "./jira-types.js";

export type JiraOperationErrorCode =
  | "invalid_preview"
  | "state_changed"
  | "transition_not_available"
  | "unsupported_transition_field";

export class JiraOperationError extends Error {
  public constructor(
    public readonly code: JiraOperationErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "JiraOperationError";
  }
}

export type IssueSummary = {
  readonly key: string;
  readonly summary: string;
  readonly status: { readonly id: string; readonly name: string };
};

type TransitionPreview = {
  readonly phase: "preview";
  readonly canConfirm: boolean;
  readonly previewToken: string | null;
  readonly expiresAt: number | null;
  readonly issue: IssueSummary;
  readonly transition: JiraTransition;
  readonly fields: Readonly<Record<string, unknown>>;
  readonly missingFields: readonly {
    readonly id: string;
    readonly name: string;
  }[];
};

type TransitionResult = {
  readonly phase: "executed";
  readonly executed: true;
  readonly verified: boolean;
  readonly issueKey: string;
  readonly expectedStatus: { readonly id: string; readonly name: string };
  readonly actualStatus: { readonly id: string; readonly name: string } | null;
  readonly verificationError?: string;
};

type CommentPreview = {
  readonly phase: "preview";
  readonly previewToken: string;
  readonly expiresAt: number;
  readonly issue: IssueSummary;
  readonly comment: { readonly body: string };
};

type CommentResult = {
  readonly phase: "executed";
  readonly executed: true;
  readonly verified: boolean;
  readonly issueKey: string;
  readonly comment: JiraComment;
  readonly verificationError?: string;
};

export class JiraService {
  public constructor(
    private readonly gateway: JiraGateway,
    private readonly previews: PreviewStore,
  ) {}

  public getCurrentUser(): Promise<JiraUser> {
    return this.gateway.getCurrentUser();
  }

  public searchIssues(request: JiraSearchRequest): Promise<JiraSearchResult> {
    return this.gateway.searchIssues(request);
  }

  public getIssue(issueKey: string): Promise<JiraIssue> {
    return this.gateway.getIssue(issueKey);
  }

  public getTransitions(issueKey: string): Promise<readonly JiraTransition[]> {
    return this.gateway.getTransitions(issueKey);
  }

  public getAttachments(issueKey: string): Promise<readonly JiraAttachment[]> {
    return this.gateway.getAttachments(issueKey);
  }

  public downloadAttachment(
    attachmentId: string,
  ): Promise<JiraAttachmentDownload> {
    return this.gateway.downloadAttachment(attachmentId);
  }

  public getLinkedIssues(issueKey: string): Promise<readonly JiraIssueLink[]> {
    return this.gateway.getLinkedIssues(issueKey);
  }

  public async previewTransition(
    issueKey: string,
    transitionId: string,
    fields: Readonly<Record<string, unknown>>,
  ): Promise<TransitionPreview> {
    const [issue, transitions] = await Promise.all([
      this.gateway.getIssue(issueKey),
      this.gateway.getTransitions(issueKey),
    ]);
    const transition = transitions.find(
      (candidate) => candidate.id === transitionId,
    );
    if (!transition) {
      throw new JiraOperationError(
        "transition_not_available",
        `Transition ${transitionId} is not available for ${issueKey}`,
      );
    }
    assertSupportedFields(fields, transition);
    const missingFields = requiredFieldsMissing(fields, transition);
    if (missingFields.length > 0) {
      return transitionPreview(issue, transition, fields, missingFields, null);
    }
    const pending: PendingTransition = {
      kind: "transition",
      issueKey: issue.key,
      transitionId: transition.id,
      fields,
      fromStatusId: issue.fields.status.id,
      toStatusId: transition.to.id,
      toStatusName: transition.to.name,
    };
    return transitionPreview(
      issue,
      transition,
      fields,
      [],
      this.previews.create(pending),
    );
  }

  public async confirmTransition(
    previewToken: string,
  ): Promise<TransitionResult> {
    const pending = this.consumeTransition(previewToken);
    const currentIssue = await this.gateway.getIssue(pending.issueKey);
    if (currentIssue.fields.status.id !== pending.fromStatusId) {
      throw new JiraOperationError(
        "state_changed",
        `Issue ${pending.issueKey} status changed after preview; request a new preview`,
      );
    }
    await this.gateway.transitionIssue(
      pending.issueKey,
      pending.transitionId,
      pending.fields ?? {},
    );
    return this.verifyTransition(pending);
  }

  public async previewComment(
    issueKey: string,
    body: string,
  ): Promise<CommentPreview> {
    const issue = await this.gateway.getIssue(issueKey);
    const preview = this.previews.create({
      kind: "comment",
      issueKey: issue.key,
      body,
    });
    return {
      phase: "preview",
      previewToken: preview.token,
      expiresAt: preview.expiresAt,
      issue: summarizeIssue(issue),
      comment: { body },
    };
  }

  public async confirmComment(previewToken: string): Promise<CommentResult> {
    const pending = this.consumeComment(previewToken);
    const created = await this.gateway.addComment(
      pending.issueKey,
      pending.body,
    );
    try {
      const comment = await this.gateway.getComment(
        pending.issueKey,
        created.id,
      );
      return {
        phase: "executed",
        executed: true,
        verified: comment.id === created.id && comment.body === pending.body,
        issueKey: pending.issueKey,
        comment,
      };
    } catch (error) {
      return {
        phase: "executed",
        executed: true,
        verified: false,
        issueKey: pending.issueKey,
        comment: created,
        verificationError: safeErrorMessage(error),
      };
    }
  }

  private consumeTransition(token: string): PendingTransition {
    const operation = this.consume(token);
    if (operation.kind !== "transition") {
      throw new JiraOperationError(
        "invalid_preview",
        "Preview token is not for a transition",
      );
    }
    return operation;
  }

  private consumeComment(token: string): PendingComment {
    const operation = this.consume(token);
    if (operation.kind !== "comment") {
      throw new JiraOperationError(
        "invalid_preview",
        "Preview token is not for a comment",
      );
    }
    return operation;
  }

  private consume(token: string): PendingOperation {
    try {
      return this.previews.consume(token);
    } catch (error) {
      if (error instanceof PreviewTokenError) {
        throw new JiraOperationError("invalid_preview", error.message, {
          cause: error,
        });
      }
      throw error;
    }
  }

  private async verifyTransition(
    pending: PendingTransition,
  ): Promise<TransitionResult> {
    try {
      const issue = await this.gateway.getIssue(pending.issueKey);
      return {
        phase: "executed",
        executed: true,
        verified: issue.fields.status.id === pending.toStatusId,
        issueKey: pending.issueKey,
        expectedStatus: { id: pending.toStatusId, name: pending.toStatusName },
        actualStatus: issue.fields.status,
      };
    } catch (error) {
      return {
        phase: "executed",
        executed: true,
        verified: false,
        issueKey: pending.issueKey,
        expectedStatus: { id: pending.toStatusId, name: pending.toStatusName },
        actualStatus: null,
        verificationError: safeErrorMessage(error),
      };
    }
  }
}

function transitionPreview(
  issue: JiraIssue,
  transition: JiraTransition,
  fields: Readonly<Record<string, unknown>>,
  missingFields: readonly { readonly id: string; readonly name: string }[],
  preview: { readonly token: string; readonly expiresAt: number } | null,
): TransitionPreview {
  return {
    phase: "preview",
    canConfirm: preview !== null,
    previewToken: preview?.token ?? null,
    expiresAt: preview?.expiresAt ?? null,
    issue: summarizeIssue(issue),
    transition,
    fields,
    missingFields,
  };
}

function summarizeIssue(issue: JiraIssue): IssueSummary {
  return {
    key: issue.key,
    summary: issue.fields.summary,
    status: issue.fields.status,
  };
}

function requiredFieldsMissing(
  fields: Readonly<Record<string, unknown>>,
  transition: JiraTransition,
): readonly { readonly id: string; readonly name: string }[] {
  return Object.entries(transition.fields)
    .filter(
      ([id, metadata]) =>
        metadata.required &&
        !metadata.hasDefaultValue &&
        (!Object.hasOwn(fields, id) ||
          fields[id] === null ||
          fields[id] === ""),
    )
    .map(([id, metadata]) => ({ id, name: metadata.name }));
}

function assertSupportedFields(
  fields: Readonly<Record<string, unknown>>,
  transition: JiraTransition,
): void {
  const unsupported = Object.keys(fields).filter(
    (field) => !Object.hasOwn(transition.fields, field),
  );
  if (unsupported.length > 0) {
    throw new JiraOperationError(
      "unsupported_transition_field",
      `Fields are not present on the transition screen: ${unsupported.join(", ")}`,
    );
  }
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown verification error";
}
