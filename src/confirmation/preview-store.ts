import { randomUUID } from "node:crypto";

export type PendingComment = {
  readonly kind: "comment";
  readonly issueKey: string;
  readonly body: string;
};

export type PendingTransition = {
  readonly kind: "transition";
  readonly issueKey: string;
  readonly transitionId: string;
  readonly fields?: Readonly<Record<string, unknown>>;
  readonly fromStatusId: string;
  readonly toStatusId: string;
  readonly toStatusName: string;
};

export type PendingOperation = PendingComment | PendingTransition;

export type PreviewToken = {
  readonly token: string;
  readonly expiresAt: number;
};

type StoredPreview = PreviewToken & {
  readonly operation: PendingOperation;
};

type PreviewStoreOptions = {
  readonly ttlMs: number;
  readonly now?: () => number;
  readonly tokenFactory?: () => string;
};

export class PreviewTokenError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PreviewTokenError";
  }
}

export class PreviewStore {
  private readonly entries = new Map<string, StoredPreview>();
  private readonly options: Required<PreviewStoreOptions>;

  public constructor(options: PreviewStoreOptions) {
    this.options = {
      ...options,
      now: options.now ?? Date.now,
      tokenFactory: options.tokenFactory ?? randomUUID,
    };
  }

  public create(operation: PendingOperation): PreviewToken {
    this.removeExpired();
    const token = this.options.tokenFactory();
    const preview = {
      operation,
      token,
      expiresAt: this.options.now() + this.options.ttlMs,
    };
    this.entries.set(token, preview);
    return { token: preview.token, expiresAt: preview.expiresAt };
  }

  public consume(token: string): PendingOperation {
    const preview = this.entries.get(token);
    if (!preview)
      throw new PreviewTokenError("Preview token is invalid or already used");
    this.entries.delete(token);
    if (preview.expiresAt < this.options.now()) {
      throw new PreviewTokenError("Preview token has expired");
    }
    return preview.operation;
  }

  private removeExpired(): void {
    const now = this.options.now();
    for (const [token, preview] of this.entries) {
      if (preview.expiresAt < now) this.entries.delete(token);
    }
  }
}
