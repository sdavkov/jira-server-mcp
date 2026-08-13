import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";

import { JiraError } from "../jira/jira-errors.js";
import { JiraOperationError } from "../jira/jira-service.js";
import type { JiraService } from "../jira/jira-service.js";
import type { JiraAttachmentDownload } from "../jira/jira-types.js";

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

const mutationAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
} as const;

const IssueKeySchema = z.string().trim().min(1).max(255);
const JiraNumericIdSchema = z.string().trim().regex(/^\d+$/u).max(32);
const PreviewTokenSchema = z.string().uuid();
const FieldsSchema = z.record(z.string(), z.unknown());

export function createMcpServer(service: JiraService): McpServer {
  const server = new McpServer(
    { name: "jira-server-mcp", version: "0.2.0" },
    {
      instructions:
        "Read tools need no confirmation. Use jira_get_attachments and jira_get_attachment to inspect files without a browser, and jira_get_linked_issues to discover related Jira issue keys. jira_transition_issue and jira_add_comment MUST first be called with confirm=false to obtain a previewToken. Execute only after showing the preview to the user and receiving explicit approval, then call the same tool with confirm=true and that token. Never invent or reuse tokens.",
    },
  );

  registerReadTools(server, service);
  registerMutationTools(server, service);
  return server;
}

function registerReadTools(server: McpServer, service: JiraService): void {
  server.registerTool(
    "jira_get_current_user",
    {
      title: "Get current Jira user",
      description:
        "Return the Jira account authenticated by this local MCP server.",
      inputSchema: z.object({}).strict(),
      annotations: readOnlyAnnotations,
    },
    () => execute(() => service.getCurrentUser()),
  );

  server.registerTool(
    "jira_search_issues",
    {
      title: "Search Jira issues",
      description:
        "Search Jira Server with JQL. Defaults to issues assigned to currentUser(), ordered by most recently updated.",
      inputSchema: z
        .object({
          jql: z
            .string()
            .trim()
            .min(1)
            .max(20_000)
            .default("assignee = currentUser() ORDER BY updated DESC"),
          startAt: z.number().int().min(0).default(0),
          maxResults: z.number().int().min(1).max(100).default(50),
          fields: z
            .array(z.string().trim().min(1).max(255))
            .max(50)
            .default(["summary", "status", "assignee", "priority", "updated"]),
        })
        .strict(),
      annotations: readOnlyAnnotations,
    },
    (request) => execute(() => service.searchIssues(request)),
  );

  server.registerTool(
    "jira_get_issue",
    {
      title: "Get Jira issue",
      description: "Return the main fields of one Jira issue by key.",
      inputSchema: z.object({ issueKey: IssueKeySchema }).strict(),
      annotations: readOnlyAnnotations,
    },
    ({ issueKey }) => execute(() => service.getIssue(issueKey)),
  );

  server.registerTool(
    "jira_get_transitions",
    {
      title: "Get available Jira transitions",
      description:
        "Return workflow transitions available to the current Jira user, including destination statuses and transition-screen field metadata.",
      inputSchema: z.object({ issueKey: IssueKeySchema }).strict(),
      annotations: readOnlyAnnotations,
    },
    ({ issueKey }) => execute(() => service.getTransitions(issueKey)),
  );

  server.registerTool(
    "jira_get_attachments",
    {
      title: "List Jira issue attachments",
      description:
        "Return attachment IDs and metadata for an issue. Use jira_get_attachment with an attachment ID to retrieve its content without a browser session.",
      inputSchema: z.object({ issueKey: IssueKeySchema }).strict(),
      annotations: readOnlyAnnotations,
    },
    ({ issueKey }) => execute(() => service.getAttachments(issueKey)),
  );

  server.registerTool(
    "jira_get_attachment",
    {
      title: "Get Jira attachment content",
      description:
        "Download one Jira attachment by numeric ID with the configured Jira account. Images are returned as MCP image content; other files are returned as embedded binary resources.",
      inputSchema: z.object({ attachmentId: JiraNumericIdSchema }).strict(),
      annotations: readOnlyAnnotations,
    },
    ({ attachmentId }) =>
      executeAttachment(() => service.downloadAttachment(attachmentId)),
  );

  server.registerTool(
    "jira_get_linked_issues",
    {
      title: "Get linked Jira issues",
      description:
        "Return inward and outward Jira issue links, their relationship labels, and linked issue keys. The linked keys can be used with all existing Jira issue tools.",
      inputSchema: z.object({ issueKey: IssueKeySchema }).strict(),
      annotations: readOnlyAnnotations,
    },
    ({ issueKey }) => execute(() => service.getLinkedIssues(issueKey)),
  );
}

function registerMutationTools(server: McpServer, service: JiraService): void {
  server.registerTool(
    "jira_transition_issue",
    {
      title: "Preview or execute Jira transition",
      description:
        "With confirm=false, validate and preview a workflow transition. With confirm=true, execute only a previously previewed operation using its one-time previewToken, then verify the actual Jira status.",
      inputSchema: z
        .object({
          issueKey: IssueKeySchema.optional(),
          transitionId: z.string().trim().min(1).max(255).optional(),
          fields: FieldsSchema.default({}),
          confirm: z.boolean().default(false),
          previewToken: PreviewTokenSchema.optional(),
        })
        .strict(),
      annotations: mutationAnnotations,
    },
    (request) =>
      execute(() => {
        if (request.confirm) {
          return service.confirmTransition(
            requirePreviewToken(request.previewToken),
          );
        }
        return service.previewTransition(
          requireArgument(request.issueKey, "issueKey"),
          requireArgument(request.transitionId, "transitionId"),
          request.fields,
        );
      }),
  );

  server.registerTool(
    "jira_add_comment",
    {
      title: "Preview or add Jira comment",
      description:
        "With confirm=false, preview a comment without writing. With confirm=true, add only a previously previewed comment using its one-time previewToken, then verify the exact created comment by ID.",
      inputSchema: z
        .object({
          issueKey: IssueKeySchema.optional(),
          body: z.string().min(1).max(32_767).optional(),
          confirm: z.boolean().default(false),
          previewToken: PreviewTokenSchema.optional(),
        })
        .strict(),
      annotations: mutationAnnotations,
    },
    (request) =>
      execute(() => {
        if (request.confirm) {
          return service.confirmComment(
            requirePreviewToken(request.previewToken),
          );
        }
        return service.previewComment(
          requireArgument(request.issueKey, "issueKey"),
          requireArgument(request.body, "body"),
        );
      }),
  );
}

async function execute(
  operation: () => Promise<unknown>,
): Promise<CallToolResult> {
  try {
    const result = toJsonValue(await operation());
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  } catch (error) {
    return toolErrorResult(error);
  }
}

async function executeAttachment(
  operation: () => Promise<JiraAttachmentDownload>,
): Promise<CallToolResult> {
  try {
    const download = await operation();
    const metadata = toJsonValue({
      attachment: download.attachment,
      bytes: download.content.byteLength,
    });
    return {
      content: [
        { type: "text", text: JSON.stringify(metadata, null, 2) },
        attachmentContent(download),
      ],
      structuredContent: metadata,
    };
  } catch (error) {
    return toolErrorResult(error);
  }
}

function attachmentContent(
  download: JiraAttachmentDownload,
): CallToolResult["content"][number] {
  const data = Buffer.from(download.content).toString("base64");
  if (download.attachment.mimeType.startsWith("image/")) {
    return { type: "image", data, mimeType: download.attachment.mimeType };
  }
  return {
    type: "resource",
    resource: {
      uri: `jira-attachment:///${download.attachment.id}/${encodeURIComponent(download.attachment.filename)}`,
      blob: data,
      mimeType: download.attachment.mimeType,
    },
  };
}

function toolErrorResult(error: unknown): CallToolResult {
  const safe = safeToolError(error);
  return {
    isError: true,
    content: [{ type: "text", text: safe.message }],
    structuredContent: { error: safe },
  };
}

function requirePreviewToken(value: string | undefined): string {
  if (!value) {
    throw new ToolInputError(
      "confirmation_required",
      "confirm=true requires previewToken from a previous preview call",
    );
  }
  return value;
}

function requireArgument(value: string | undefined, name: string): string {
  if (!value) {
    throw new ToolInputError(
      "missing_argument",
      `${name} is required when confirm=false`,
    );
  }
  return value;
}

class ToolInputError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ToolInputError";
  }
}

function safeToolError(error: unknown): {
  readonly code: string;
  readonly message: string;
  readonly status?: number;
  readonly details?: readonly string[];
} {
  if (error instanceof JiraError) {
    return compactError(error.code, error.message, error.status, error.details);
  }
  if (error instanceof JiraOperationError || error instanceof ToolInputError) {
    return { code: error.code, message: error.message };
  }
  return { code: "unexpected_error", message: "Unexpected Jira MCP error" };
}

function compactError(
  code: string,
  message: string,
  status: number | undefined,
  details: readonly string[],
): {
  readonly code: string;
  readonly message: string;
  readonly status?: number;
  readonly details?: readonly string[];
} {
  return {
    code,
    message,
    ...(status === undefined ? {} : { status }),
    ...(details.length === 0 ? {} : { details }),
  };
}

function toJsonValue(value: unknown): Record<string, unknown> {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) return {};
  const parsed = JSON.parse(serialized) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { value: parsed };
  }
  return parsed as Record<string, unknown>;
}
