import { z } from "zod";

const BasicAuthSchema = z
  .object({
    type: z.literal("basic"),
    username: z.string().trim().min(1, "Jira username is required"),
    password: z.string().min(1, "Jira password is required"),
  })
  .strict();

const JiraUrlSchema = z
  .url("Jira baseUrl must be a valid URL")
  .transform((value, context) => {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      context.addIssue({
        code: "custom",
        message: "Jira baseUrl must use HTTPS",
      });
      return z.NEVER;
    }
    if (url.username || url.password || url.search || url.hash) {
      context.addIssue({
        code: "custom",
        message:
          "Jira baseUrl must not contain credentials, query, or fragment",
      });
      return z.NEVER;
    }
    return url.toString().replace(/\/$/, "");
  });

export const AppConfigSchema = z
  .object({
    jira: z
      .object({
        baseUrl: JiraUrlSchema,
        auth: BasicAuthSchema,
        timeoutMs: z.number().int().min(1_000).max(120_000).default(15_000),
        previewTtlMs: z
          .number()
          .int()
          .min(10_000)
          .max(900_000)
          .default(300_000),
      })
      .strict(),
  })
  .strict();

export type AppConfig = z.infer<typeof AppConfigSchema>;
