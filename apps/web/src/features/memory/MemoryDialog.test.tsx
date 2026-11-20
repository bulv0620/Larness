import type { MemoryDto } from "@larness/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MemoryDialog } from "./MemoryDialog";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    listProjectMemories: vi.fn(),
    forgetProjectMemory: vi.fn(),
    updateProjectMemory: vi.fn(),
    createProjectMemory: vi.fn(),
    listGlobalMemories: vi.fn(),
  };
});

const api = await import("./api");
const listProjectMemories = vi.mocked(api.listProjectMemories);
const forgetProjectMemory = vi.mocked(api.forgetProjectMemory);

function memory(overrides: Partial<MemoryDto> = {}): MemoryDto {
  return {
    id: "mem_1",
    scope: "project",
    projectId: "prj_1",
    kind: "command",
    key: "build.test.command",
    title: "Test command",
    body: "pnpm test",
    status: "active",
    confidence: 0.8,
    evidenceKind: "command_succeeded",
    sourceTurnId: "trn_1",
    sourceEventSeq: 3,
    createdBy: "agent",
    useCount: 2,
    lastUsedAt: 1_000,
    lastConfirmedAt: 1_000,
    correctionCount: 0,
    pinned: false,
    bytes: 40,
    verifiedAt: 1_000,
    expiresAt: null,
    createdAt: 1_000,
    updatedAt: 2_000,
    stale: false,
    revisionCount: 1,
    ...overrides,
  };
}

function renderDialog() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryDialog open onOpenChange={() => {}} projectId="prj_1" />
    </QueryClientProvider>,
  );
}

describe("MemoryDialog", () => {
  it("lists project memories with budget and forgets after confirmation", async () => {
    listProjectMemories.mockResolvedValue({
      items: [memory()],
      total: 1,
      budget: {
        scope: "project",
        projectId: "prj_1",
        activeBytes: 40,
        totalBytes: 40,
        activeCount: 1,
        reviewCount: 0,
        evictedCount: 0,
        limits: { activeBytes: 65_536, totalBytes: 196_608, activeCount: 300 },
      },
    });
    forgetProjectMemory.mockResolvedValue();

    renderDialog();

    expect(await screen.findByText("Test command")).toBeInTheDocument();
    expect(screen.getByText(/active 1 条/)).toBeInTheDocument();
    expect(screen.getByText("build.test.command")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Test command/ }));
    await user.click(await screen.findByRole("button", { name: "忘记" }));
    expect(await screen.findByText("忘记这条记忆")).toBeInTheDocument();
    const forget = screen.getAllByRole("button", { name: "忘记" }).at(-1);
    if (forget === undefined) throw new Error("confirm button missing");
    await user.click(forget);

    await waitFor(() => {
      expect(forgetProjectMemory).toHaveBeenCalledWith("prj_1", "mem_1", 2_000);
    });
  });

  it("shows review actions for a pending memory", async () => {
    listProjectMemories.mockResolvedValue({
      items: [memory({ status: "review" })],
      total: 1,
      budget: {
        scope: "project",
        projectId: "prj_1",
        activeBytes: 0,
        totalBytes: 40,
        activeCount: 0,
        reviewCount: 1,
        evictedCount: 0,
        limits: { activeBytes: 65_536, totalBytes: 196_608, activeCount: 300 },
      },
    });

    renderDialog();

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Test command/ }));
    expect(await screen.findByRole("button", { name: "接受" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "拒绝" })).toBeInTheDocument();
  });
});
