export type JiraErrorCode =
  | "invalid_request"
  | "authentication_failed"
  | "captcha_blocked"
  | "permission_denied"
  | "not_found_or_hidden"
  | "jira_unavailable"
  | "network_error"
  | "request_timeout"
  | "attachment_too_large"
  | "unexpected_response";

type JiraErrorOptions = ErrorOptions & {
  readonly status?: number;
  readonly details?: readonly string[];
};

export class JiraError extends Error {
  public readonly code: JiraErrorCode;
  public readonly status: number | undefined;
  public readonly details: readonly string[];

  public constructor(
    code: JiraErrorCode,
    message: string,
    options: JiraErrorOptions = {},
  ) {
    super(message, options);
    this.name = "JiraError";
    this.code = code;
    this.status = options.status;
    this.details = options.details ?? [];
  }
}
