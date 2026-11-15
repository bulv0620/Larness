import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createProject, listDirectories } from "@/lib/workspaceApi";
import { ProjectDialog } from "./ProjectDialog";

vi.mock("@/lib/workspaceApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workspaceApi")>();
  return {
    ...actual,
    createProject: vi.fn(),
    listDirectories: vi.fn(),
  };
});

const listDirectoriesMock = vi.mocked(listDirectories);
const createProjectMock = vi.mocked(createProject);

function renderDialog(onOpenChange = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <ProjectDialog open onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  );

  return onOpenChange;
}

describe("ProjectDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listDirectoriesMock.mockImplementation(async (directory) =>
      directory === "/Users/me/work"
        ? {
            path: "/Users/me/work",
            parent: "/Users/me",
            home: "/Users/me",
            entries: [],
            truncated: false,
            roots: [{ name: "Backup", path: "/Volumes/Backup" }],
          }
        : {
            path: "/Users/me",
            parent: "/Users",
            home: "/Users/me",
            entries: [{ name: "work", path: "/Users/me/work" }],
            truncated: false,
            roots: [{ name: "Backup", path: "/Volumes/Backup" }],
          },
    );
    createProjectMock.mockResolvedValue({
      id: "prj_1",
      name: "work",
    } as never);
  });

  it("uses the browsed directory immediately and submits the display name", async () => {
    const user = userEvent.setup();
    const onOpenChange = renderDialog();

    await waitFor(() => expect(screen.getByText("/Users/me")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "添加项目" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "work" }));

    await waitFor(() => expect(listDirectoriesMock).toHaveBeenLastCalledWith("/Users/me/work"));
    expect(await screen.findByText("/Users/me/work")).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: "选择当前目录" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("项目目录")).toHaveValue("/Users/me/work");
    await user.type(screen.getByLabelText("显示名称（可选）"), "Work project");

    await user.click(screen.getByRole("button", { name: "添加项目" }));
    await waitFor(() =>
      expect(createProjectMock).toHaveBeenCalledWith({
        rootPath: "/Users/me/work",
        name: "Work project",
      }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("switches Windows drives and keeps the display name while browsing", async () => {
    const user = userEvent.setup();
    const roots = [
      { name: "C:", path: "C:\\" },
      { name: "D:", path: "D:\\" },
    ];
    listDirectoriesMock.mockImplementation(async (directory) => ({
      path: directory ?? "C:\\Users\\me",
      home: "C:\\Users\\me",
      parent: null,
      entries: directory === "D:\\" ? [{ name: "repo", path: "D:\\repo" }] : [],
      roots,
      truncated: false,
    }));
    renderDialog();

    await user.type(screen.getByLabelText("显示名称（可选）"), "My project");
    await user.click(await screen.findByRole("button", { name: "磁盘与卷" }));
    await user.click(await screen.findByRole("menuitem", { name: "D:" }));
    await user.click(await screen.findByRole("button", { name: "repo" }));
    expect(screen.getByLabelText("项目目录")).toHaveValue("D:\\repo");
    expect(screen.getByLabelText("显示名称（可选）")).toHaveValue("My project");
  });

  it("leaves the project path editable after a volume disappears", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(await screen.findByRole("button", { name: "work" }));
    await waitFor(() => expect(screen.getByLabelText("项目目录")).toHaveValue("/Users/me/work"));
    listDirectoriesMock.mockRejectedValueOnce(new Error("disk unavailable"));

    await user.click(screen.getByRole("button", { name: "磁盘与卷" }));
    await user.click(await screen.findByRole("menuitem", { name: "Backup" }));
    expect(await screen.findByText("无法读取目录")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加项目" })).toBeDisabled();
    await user.type(screen.getByLabelText("项目目录"), "/Users/me/manual");
    await user.click(screen.getByRole("button", { name: "添加项目" }));
    expect(createProjectMock).toHaveBeenCalledWith({ rootPath: "/Users/me/manual" });
  });
});
