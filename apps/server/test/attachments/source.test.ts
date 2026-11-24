import { describe, expect, it } from "vitest";
import {
  htmlOutline,
  htmlStyles,
  htmlToMarkdown,
} from "../../src/modules/attachments/extractors/html.js";
import {
  sourceLineCount,
  sourceOutline,
  sourceSlice,
} from "../../src/modules/attachments/source.js";

const numbered = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join("\n");

describe("attachment source view", () => {
  it("pages by line and reports the next line anchor", () => {
    const slice = sourceSlice(numbered, { line: 10, maxChars: 60 });
    expect(slice.lineStart).toBe(10);
    expect(slice.content.startsWith("line 10")).toBe(true);
    expect(slice.totalLines).toBe(40);
    expect(slice.nextLine).toBe(slice.lineEnd + 1);
    expect(slice.nextOffset).toBeGreaterThan(0);
  });

  it("returns the whole file without a next anchor at the end", () => {
    const slice = sourceSlice("a\nb\n", { maxChars: 12_000 });
    expect(slice.content).toBe("a\nb\n");
    expect(slice.lineStart).toBe(1);
    expect(slice.lineEnd).toBe(2);
    expect(slice.nextLine).toBeNull();
    expect(slice.nextOffset).toBeNull();
    expect(slice.truncated).toBe(false);
  });

  it("falls back to a character offset inside an oversized single line", () => {
    const minified = "a".repeat(50_000);
    const slice = sourceSlice(minified, { maxChars: 2_000 });
    expect(slice.content).toHaveLength(2_000);
    expect(slice.truncated).toBe(true);
    // Re-reading from nextOffset must make progress instead of looping.
    expect(slice.nextLine).toBeNull();
    expect(slice.nextOffset).toBe(2_000);
    const rest = sourceSlice(minified, { offset: slice.nextOffset ?? 0, maxChars: 2_000 });
    expect(rest.content.startsWith("a")).toBe(true);
    expect(rest.lineStart).toBe(1);
  });

  it("counts lines of an empty file as zero", () => {
    expect(sourceLineCount("")).toBe(0);
    expect(sourceSlice("", { maxChars: 2_000 }).totalLines).toBe(0);
  });

  it("outlines imports and top-level symbols of a large source file", () => {
    const outline = sourceOutline(
      ['import { a } from "./a";', "", "export function run() {", "}", "const x = 1;"].join("\n"),
      "run.ts",
    );
    expect(outline).toContain("lines: 5");
    expect(outline).toContain("imports:");
    expect(outline).toContain('import { a } from "./a";');
    expect(outline).toContain("export function run() {");
  });

  it("outlines CSS selectors instead of code symbols", () => {
    const outline = sourceOutline(".card {\n  color: red;\n}\n", "page.css");
    expect(outline).toContain("symbols:");
    expect(outline).toContain(".card");
  });
});

describe("HTML structure extraction", () => {
  const html = [
    "<!doctype html>",
    "<html>",
    "<head>",
    "<style>.card { display: flex; color: #c00; }</style>",
    "<script>alert(1)</script>",
    "</head>",
    "<body>",
    '<div id="app" class="shell root">',
    '<section class="card">',
    "<h1>Checkout</h1>",
    "<table><tr><th>Field</th><th>Type</th></tr><tr><td>amount</td><td>int</td></tr></table>",
    "</section>",
    "</div>",
    "</body>",
    "</html>",
  ].join("\n");

  it("keeps embedded CSS as a fenced block", () => {
    const styles = htmlStyles(html);
    expect(styles.css).toContain(".card { display: flex; color: #c00; }");
    expect(styles.truncated).toBe(false);
    const result = htmlToMarkdown(html);
    expect(result.markdown).toContain("## Embedded styles");
    expect(result.markdown).toContain("```css");
    expect(result.markdown).toContain(".card { display: flex; color: #c00; }");
  });

  it("keeps the element skeleton with ids and classes", () => {
    expect(htmlOutline(html)).toEqual(["div#app.shell.root", "section.card"]);
    const result = htmlToMarkdown(html);
    expect(result.markdown).toContain("## Structure outline");
    expect(result.markdown).toContain("- div#app.shell.root");
    expect(result.markdown).toContain("- section.card");
  });

  it("converts tables into pipe tables and still drops scripts", () => {
    const result = htmlToMarkdown(html);
    expect(result.markdown).toContain("| Field | Type |");
    expect(result.markdown).toContain("| amount | int |");
    expect(result.markdown).not.toContain("alert(1)");
    expect(result.removed).toBe(1);
  });
});
