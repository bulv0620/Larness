import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { createTerminal, openTerminal } from "./api";
import { CreateTerminalButton } from "./CreateTerminalButton";

vi.mock("./api", () => ({ createTerminal: vi.fn(), openTerminal: vi.fn() }));

it("creates only after confirmation, pins the scope and retries with the same idempotency key", async () => {
  vi.mocked(createTerminal).mockRejectedValue(new Error("Unconfirmed"));
  const { rerender } = render(<CreateTerminalButton scope={{ projectId: "prj_original" }} />);
  fireEvent.click(screen.getByRole("button", { name: "新建终端" }));
  expect(screen.getByRole("dialog", { name: "创建终端确认" })).toHaveTextContent(
    "终端以本机账户权限运行，可访问项目外文件。",
  );
  expect(createTerminal).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(createTerminal).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "新建终端" }));
  rerender(<CreateTerminalButton scope={{ workspace: "default" }} />);
  fireEvent.click(screen.getByRole("button", { name: "确认创建" }));
  await screen.findByRole("alert");
  const first = vi.mocked(createTerminal).mock.calls[0];
  expect(first).toEqual([{ projectId: "prj_original" }, expect.any(String)]);
  fireEvent.click(screen.getByRole("button", { name: "确认创建" }));
  await waitFor(() => expect(createTerminal).toHaveBeenCalledTimes(2));
  expect(vi.mocked(createTerminal).mock.calls[1]).toEqual(first);
  expect(openTerminal).not.toHaveBeenCalled();
});
