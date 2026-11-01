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
          }
        : {
            path: "/Users/me",
            parent: "/Users",
            home: "/Users/me",
            entries: [{ name: "work", path: "/Users/me/work" }],
            truncated: false,
          },
    );
    createProjectMock.mockResolvedValue({
      id: "prj_1",
      name: "work",
    } as never);
  });

  it("browses directories and selects the current folder", async () => {
    const user = userEvent.setup();
    const onOpenChange = renderDialog();

    await waitFor(() => expect(screen.getByText("/Users/me")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "work" }));

    await waitFor(() => expect(listDirectoriesMock).toHaveBeenLastCalledWith("/Users/me/work"));
    expect(await screen.findByText("/Users/me/work")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "选择当前目录" }));
    expect(screen.getByLabelText("项目目录")).toHaveValue("/Users/me/work");
    expect(screen.getByLabelText("显示名称（可选）")).toHaveValue("work");

    await user.click(screen.getByRole("button", { name: "添加项目" }));
    await waitFor(() =>
      expect(createProjectMock).toHaveBeenCalledWith({
        rootPath: "/Users/me/work",
        name: "work",
      }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
