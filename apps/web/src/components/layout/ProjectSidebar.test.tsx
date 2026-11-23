import type { GatewaySnapshot } from "@larness/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useNavigationStore } from "@/stores/navigationStore";
import { ProjectSidebar } from "./ProjectSidebar";

const mocks = vi.hoisted(() => ({
  snapshot: {} as GatewaySnapshot,
  reorderProjects: vi.fn(async () => undefined),
  getJobsSummary: vi.fn(async () => ({
    total: 0,
    enabled: 0,
    running: 0,
    failedLast24h: 0,
  })),
}));

vi.mock("@/lib/queries", () => ({
  useSnapshot: () => ({ data: mocks.snapshot }),
}));

vi.mock("@/lib/workspaceApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workspaceApi")>();
  return { ...actual, reorderProjects: mocks.reorderProjects };
});

vi.mock("@/features/auth/useAuth", () => ({
  useLogout: () => vi.fn(),
}));

vi.mock("@/features/jobs/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/jobs/api")>();
  return { ...actual, getJobsSummary: mocks.getJobsSummary };
});

vi.mock("@/features/jobs/JobsDialog", () => ({ JobsDialog: () => null }));
vi.mock("@/features/models/ModelSettingsDialog", () => ({ ModelSettingsDialog: () => null }));
vi.mock("@/features/webSearch/WebSearchSettingsDialog", () => ({
  WebSearchSettingsDialog: () => null,
}));
vi.mock("@/features/serviceOps/ServiceOpsDialog", () => ({ ServiceOpsDialog: () => null }));
vi.mock("@/features/projects/ProjectDialog", () => ({ ProjectDialog: () => null }));
vi.mock("@/features/projects/RenameProjectDialog", () => ({ RenameProjectDialog: () => null }));
vi.mock("@/features/chat/RenameSessionDialog", () => ({ RenameSessionDialog: () => null }));

function sidebarSnapshot(): GatewaySnapshot {
  return {
    projects: [
      {
        id: "prj_default",
        kind: "default",
        name: "默认工作区",
        rootPath: "/tmp/default",
        branch: null,
        git: false,
        accent: "#0A84FF",
        runningTerminals: 0,
      },
      {
        id: "prj_alpha",
        name: "Alpha",
        rootPath: "/tmp/alpha",
        branch: "main",
        git: true,
        accent: "#FF9F0A",
        runningTerminals: 0,
      },
      {
        id: "prj_beta",
        name: "Beta",
        rootPath: "/tmp/beta",
        branch: null,
        git: false,
        accent: "#30D158",
        runningTerminals: 1,
      },
    ],
    sessions: [],
    models: [],
    host: {
      cpuPercent: 0,
      memoryUsedBytes: 0,
      memoryTotalBytes: 0,
      diskUsedBytes: 0,
      diskTotalBytes: 0,
      sampledAt: 0,
    },
    services: [],
    terminals: [],
    gitChanges: [],
  };
}

function renderSidebar() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ProjectSidebar />
    </QueryClientProvider>,
  );
}

describe("ProjectSidebar project ordering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.snapshot = sidebarSnapshot();
    useNavigationStore.setState({
      projectId: null,
      sessionId: "",
      draftSession: null,
      expandedProjects: {},
    });
  });

  it("only creates a default workspace session from the plus button, not the project row", () => {
    renderSidebar();
    const defaultProject = screen.getByRole("button", { name: "默认工作区" });

    fireEvent.click(defaultProject);

    expect(useNavigationStore.getState().sessionId).toBe("");
    expect(useNavigationStore.getState().draftSession).toBeNull();
    expect(defaultProject).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(screen.getByRole("button", { name: "在 默认工作区 中新建会话" }));

    expect(useNavigationStore.getState().sessionId).toMatch(/^draft_/);
    expect(useNavigationStore.getState().draftSession?.projectId).toBeNull();
  });

  it("expands a collapsed project when starting a session from its plus button", () => {
    renderSidebar();
    const alpha = screen.getByRole("button", { name: "Alpha" });
    fireEvent.click(alpha);
    expect(alpha).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(screen.getByRole("button", { name: "在 Alpha 中新建会话" }));

    expect(useNavigationStore.getState().draftSession?.projectId).toBe("prj_alpha");
    expect(alpha).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /新会话/ })).toBeVisible();
  });

  it("expands the current project from the new session button", () => {
    renderSidebar();
    const defaultProject = screen.getByRole("button", { name: "默认工作区" });
    fireEvent.click(defaultProject);
    expect(defaultProject).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(screen.getByRole("button", { name: /^新建会话/ }));

    expect(useNavigationStore.getState().sessionId).toMatch(/^draft_/);
    expect(defaultProject).toHaveAttribute("aria-expanded", "true");
  });

  it("shows git and running-terminal indicators instead of git text", async () => {
    const first = renderSidebar();
    const alpha = screen.getByRole("button", { name: "Alpha" });
    const beta = screen.getByRole("button", { name: "Beta" });
    const defaultProject = screen.getByRole("button", { name: "默认工作区" });

    expect(within(alpha).getByTestId("project-git-indicator")).toHaveAttribute(
      "title",
      "Git · main",
    );
    expect(within(alpha).queryByTestId("project-terminal-indicator")).toBeNull();
    expect(within(beta).getByTestId("project-terminal-indicator")).toHaveAttribute(
      "title",
      "1 个运行中的终端",
    );
    expect(within(beta).queryByTestId("project-git-indicator")).toBeNull();
    expect(within(defaultProject).queryByTestId("project-terminal-indicator")).toBeNull();
    expect(within(defaultProject).queryByTestId("project-git-indicator")).toBeNull();
    expect(screen.queryByText("no git")).toBeNull();

    first.unmount();
    mocks.snapshot = sidebarSnapshot();
    const withTerminal = mocks.snapshot.projects[1];
    if (withTerminal) withTerminal.runningTerminals = 1;
    renderSidebar();
    const alphaWithTerminal = screen.getAllByRole("button", { name: "Alpha" }).at(-1);
    if (!alphaWithTerminal) throw new Error("Expected Alpha project");
    expect(
      within(alphaWithTerminal)
        .getAllByTestId(/project-(terminal|git)-indicator/)
        .map((element) => element.dataset.testid),
    ).toEqual(["project-terminal-indicator", "project-git-indicator"]);
  });

  it("moves a project to the end by dragging the project itself", async () => {
    renderSidebar();
    const project = screen.getByRole("button", { name: "Alpha" });
    const beta = screen.getByRole("button", { name: "Beta" });
    const defaultProject = screen.getByRole("button", { name: "默认工作区" });

    fireEvent.pointerDown(project, { pointerId: 1, button: 0, clientY: 10 });
    fireEvent.pointerMove(project, { pointerId: 1, clientY: 120 });

    expect(project).toHaveAttribute("aria-expanded", "false");
    expect(beta).toHaveAttribute("aria-expanded", "false");
    expect(defaultProject).toHaveAttribute("aria-expanded", "false");

    fireEvent.pointerUp(project, { pointerId: 1, clientY: 120 });
    fireEvent.click(project);

    expect(project).toHaveAttribute("aria-expanded", "true");
    expect(beta).toHaveAttribute("aria-expanded", "true");
    expect(defaultProject).toHaveAttribute("aria-expanded", "true");
    await waitFor(() =>
      expect(mocks.reorderProjects).toHaveBeenCalledWith(["prj_beta", "prj_alpha"]),
    );
  });

  it("moves a project with the keyboard and ignores the boundary", async () => {
    renderSidebar();
    const project = screen.getByRole("button", { name: "Alpha" });

    fireEvent.keyDown(project, { key: "ArrowDown" });
    await waitFor(() =>
      expect(mocks.reorderProjects).toHaveBeenCalledWith(["prj_beta", "prj_alpha"]),
    );

    mocks.reorderProjects.mockClear();
    const beta = screen.getByRole("button", { name: "Beta" });
    fireEvent.keyDown(beta, { key: "ArrowDown" });
    expect(mocks.reorderProjects).not.toHaveBeenCalled();
  });

  it("still toggles a project on a normal click", () => {
    renderSidebar();
    const project = screen.getByRole("button", { name: "Alpha" });

    fireEvent.click(project);

    expect(project).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps the default workspace fixed and disables drag while filtering", async () => {
    renderSidebar();
    const defaultProject = screen.getByRole("button", { name: "默认工作区" });
    fireEvent.pointerDown(defaultProject, { pointerId: 1, button: 0, clientY: 10 });
    fireEvent.pointerMove(defaultProject, { pointerId: 1, clientY: 120 });
    fireEvent.pointerUp(defaultProject, { pointerId: 1, clientY: 120 });
    expect(mocks.reorderProjects).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("搜索项目或会话"), { target: { value: "Al" } });
    const alpha = screen.getByRole("button", { name: "Alpha" });
    fireEvent.keyDown(alpha, { key: "ArrowDown" });
    expect(mocks.reorderProjects).not.toHaveBeenCalled();
  });

  it("keeps the five admin entries in one compact icon row with short labels", () => {
    renderSidebar();

    const group = screen.getByRole("group", { name: "服务与设置" });
    const entries = within(group).getAllByRole("button");

    expect(entries).toHaveLength(5);
    expect(entries.map((entry) => entry.getAttribute("aria-label"))).toEqual([
      "服务运维",
      "自动化任务",
      "记忆与偏好",
      "联网搜索",
      "模型与凭据",
    ]);
    expect(entries.map((entry) => entry.textContent)).toEqual([
      "服务",
      "任务",
      "记忆",
      "搜索",
      "模型",
    ]);
    expect(within(group).queryByRole("button", { name: "服务与设置" })).toBeNull();
  });

  it("shows the jobs failure badge on the compact admin entry", async () => {
    mocks.getJobsSummary.mockResolvedValue({
      total: 2,
      enabled: 2,
      running: 0,
      failedLast24h: 2,
    });
    renderSidebar();

    const jobsEntry = await screen.findByRole("button", {
      name: "自动化任务，2 个失败任务",
    });
    expect(within(jobsEntry).getByText("2")).toBeInTheDocument();
  });
});
