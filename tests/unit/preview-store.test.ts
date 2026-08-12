import { describe, expect, it } from "vitest";

import {
  PreviewStore,
  PreviewTokenError,
} from "../../src/confirmation/preview-store.js";

describe("PreviewStore", () => {
  it("returns an operation exactly once for a valid token", () => {
    const store = new PreviewStore({
      ttlMs: 5_000,
      now: () => 1_000,
      tokenFactory: () => "preview-token",
    });
    const pending = {
      kind: "comment" as const,
      issueKey: "TEST-1",
      body: "Test comment",
    };

    const preview = store.create(pending);

    expect(preview).toEqual({ token: "preview-token", expiresAt: 6_000 });
    expect(store.consume(preview.token)).toEqual(pending);
    expect(() => store.consume(preview.token)).toThrow(PreviewTokenError);
  });

  it("rejects an expired token without returning the operation", () => {
    let currentTime = 1_000;
    const store = new PreviewStore({
      ttlMs: 100,
      now: () => currentTime,
      tokenFactory: () => "expired-token",
    });
    store.create({ kind: "comment", issueKey: "TEST-1", body: "Comment" });
    currentTime = 1_101;

    expect(() => store.consume("expired-token")).toThrow(/expired/i);
    expect(() => store.consume("expired-token")).toThrow(/invalid/i);
  });
});
