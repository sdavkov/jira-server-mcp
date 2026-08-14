import { describe, expect, it, vi } from "vitest";

import { PreviewStore } from "../../src/confirmation/preview-store.js";
import {
  JiraOperationError,
  JiraService,
} from "../../src/jira/jira-service.js";
import type { JiraGateway } from "../../src/jira/jira-types.js";

function createGateway(): JiraGateway {
  return {
    getCurrentUser: vi.fn(),
    searchIssues: vi.fn(),
    getIssue: vi.fn(),
    getTransitions: vi.fn(),
    transitionIssue: vi.fn(),
    addComment: vi.fn(),
    getComment: vi.fn(),
    getComments: vi.fn(),
    getAttachments: vi.fn(),
    downloadAttachment: vi.fn(),
    getLinkedIssues: vi.fn(),
  };
}

function createService(gateway: JiraGateway): JiraService {
  return new JiraService(
    gateway,
    new PreviewStore({
      ttlMs: 300_000,
      now: () => 1_000,
      tokenFactory: () => "preview-token",
    }),
  );
}

const issue = {
  id: "10001",
  key: "TEST-1",
  fields: {
    summary: "Test issue",
    status: { id: "1", name: "Open" },
  },
};

const transition = {
  id: "31",
  name: "Start Progress",
  to: { id: "3", name: "In Progress" },
  fields: {},
};

describe("JiraService transition workflow", () => {
  it("previews, executes exactly once, and verifies the destination status", async () => {
    const gateway = createGateway();
    vi.mocked(gateway.getIssue)
      .mockResolvedValueOnce(issue)
      .mockResolvedValueOnce(issue)
      .mockResolvedValueOnce({
        ...issue,
        fields: { ...issue.fields, status: { id: "3", name: "In Progress" } },
      });
    vi.mocked(gateway.getTransitions).mockResolvedValue([transition]);
    const service = createService(gateway);

    const preview = await service.previewTransition("TEST-1", "31", {});
    const result = await service.confirmTransition(preview.previewToken!);

    expect(preview).toMatchObject({
      phase: "preview",
      canConfirm: true,
      issue: { key: "TEST-1", status: { id: "1", name: "Open" } },
      transition: { id: "31", to: { id: "3", name: "In Progress" } },
    });
    expect(gateway.transitionIssue).toHaveBeenCalledOnce();
    expect(gateway.transitionIssue).toHaveBeenCalledWith("TEST-1", "31", {});
    expect(result).toMatchObject({
      phase: "executed",
      executed: true,
      verified: true,
      actualStatus: { id: "3", name: "In Progress" },
    });
    await expect(
      service.confirmTransition(preview.previewToken!),
    ).rejects.toThrow(/already used/i);
  });

  it("returns a non-confirmable preview when required transition fields are missing", async () => {
    const gateway = createGateway();
    vi.mocked(gateway.getIssue).mockResolvedValue(issue);
    vi.mocked(gateway.getTransitions).mockResolvedValue([
      {
        ...transition,
        fields: {
          resolution: {
            required: true,
            name: "Resolution",
            hasDefaultValue: false,
          },
        },
      },
    ]);
    const service = createService(gateway);

    const preview = await service.previewTransition("TEST-1", "31", {});

    expect(preview.canConfirm).toBe(false);
    expect(preview.previewToken).toBeNull();
    expect(preview.missingFields).toEqual([
      { id: "resolution", name: "Resolution" },
    ]);
  });

  it("rejects confirmation if the issue status changed after the preview", async () => {
    const gateway = createGateway();
    vi.mocked(gateway.getIssue)
      .mockResolvedValueOnce(issue)
      .mockResolvedValueOnce({
        ...issue,
        fields: { ...issue.fields, status: { id: "5", name: "Closed" } },
      });
    vi.mocked(gateway.getTransitions).mockResolvedValue([transition]);
    const service = createService(gateway);
    const preview = await service.previewTransition("TEST-1", "31", {});

    const error: unknown = await service
      .confirmTransition(preview.previewToken!)
      .catch((reason: unknown): unknown => reason);

    expect(error).toBeInstanceOf(JiraOperationError);
    if (!(error instanceof JiraOperationError)) throw error;
    expect(error.code).toBe("state_changed");
    expect(gateway.transitionIssue).not.toHaveBeenCalled();
  });
});

describe("JiraService comment workflow", () => {
  it("previews, adds, and verifies the exact comment by returned ID", async () => {
    const gateway = createGateway();
    vi.mocked(gateway.getIssue).mockResolvedValue(issue);
    vi.mocked(gateway.addComment).mockResolvedValue({
      id: "9001",
      body: "Smoke test",
      author: { name: "user", displayName: "User" },
    });
    vi.mocked(gateway.getComment).mockResolvedValue({
      id: "9001",
      body: "Smoke test",
      author: { name: "user", displayName: "User" },
    });
    const service = createService(gateway);

    const preview = await service.previewComment("TEST-1", "Smoke test");
    const result = await service.confirmComment(preview.previewToken);

    expect(preview).toMatchObject({
      phase: "preview",
      issue: { key: "TEST-1", summary: "Test issue" },
      comment: { body: "Smoke test" },
    });
    expect(gateway.addComment).toHaveBeenCalledOnce();
    expect(gateway.getComment).toHaveBeenCalledWith("TEST-1", "9001");
    expect(result).toMatchObject({
      phase: "executed",
      executed: true,
      verified: true,
      comment: { id: "9001", body: "Smoke test" },
    });
  });
});
