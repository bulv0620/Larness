import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownText } from "./MarkdownText";

describe("MarkdownText", () => {
  it("renders headings, tables, lists and inline code", () => {
    render(
      <MarkdownText
        text={
          "# 项目概况\n\n| 文件 | 作用 |\n| --- | --- |\n| `source.py` | 主程序 |\n\n- 第一项\n- 第二项"
        }
      />,
    );

    expect(screen.getByRole("heading", { level: 1, name: "项目概况" })).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "文件" })).toBeInTheDocument();
    expect(screen.getByText("source.py").tagName).toBe("CODE");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByText("| 文件 | 作用 |")).not.toBeInTheDocument();
  });
});
