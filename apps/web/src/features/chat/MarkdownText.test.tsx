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

  it("renders tables in a horizontal scroll container with natural width", () => {
    render(<MarkdownText text={"| 名称 | 状态 |\n| --- | --- |\n| 构建 | 通过 |"} />);

    const table = screen.getByRole("table");
    expect(table).toHaveClass("min-w-max");
    expect(table.parentElement).toHaveClass("overflow-x-auto");
    expect(table.parentElement).toHaveClass("overscroll-x-contain");
  });

  it("forwards GFM column alignment to header cells", () => {
    render(<MarkdownText text={"| 名称 | 状态 |\n| :---: | --- |\n| 构建 | 通过 |"} />);

    expect(screen.getByRole("columnheader", { name: "名称" })).toHaveStyle({
      textAlign: "center",
    });
  });
});
