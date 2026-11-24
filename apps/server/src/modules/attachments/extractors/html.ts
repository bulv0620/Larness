import sanitizeHtml from "sanitize-html";
import TurndownService from "turndown";
import type { DocumentExtractor, ExtractedAttachment, ExtractInput } from "../types.js";
import { escapeMarkdownCell, finishExtraction } from "./common.js";

const MAX_STYLE_CHARS = 4_000;
const MAX_OUTLINE_ENTRIES = 60;
const MAX_OUTLINE_VALUE_CHARS = 120;

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});
turndown.addRule("image", {
  filter: "img",
  replacement: (_content, node) =>
    `[image: ${(node as HTMLElement).getAttribute("alt") ?? "attachment"}]`,
});
// Turndown has no table rule; without one every cell becomes its own paragraph.
turndown.addRule("table", {
  filter: "table",
  replacement: (_content, node) => {
    const rows = Array.from((node as HTMLElement).querySelectorAll("tr")).map((row) =>
      Array.from(row.querySelectorAll("th,td")).map((cell) =>
        escapeMarkdownCell(cell.textContent ?? ""),
      ),
    );
    if (rows.length === 0) return "";
    const width = Math.max(...rows.map((row) => row.length));
    if (width === 0) return "";
    const line = (row: string[]) =>
      `| ${Array.from({ length: width }, (_, index) => row[index] ?? "").join(" | ")} |`;
    const [header = [], ...body] = rows;
    const separator = `| ${Array.from({ length: width }, () => "---").join(" | ")} |`;
    return `\n\n${[line(header), separator, ...body.map(line)].join("\n")}\n\n`;
  },
});

function attributeValue(attributes: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(attributes);
  return match?.[1] ?? match?.[2] ?? null;
}

/**
 * Flat outline of elements carrying an id or class: the page skeleton that
 * Markdown conversion drops, without shipping the whole DOM.
 */
export function htmlOutline(html: string): string[] {
  const outline: string[] = [];
  const seen = new Set<string>();
  const tagPattern = /<([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  let match = tagPattern.exec(html);
  while (match !== null && outline.length < MAX_OUTLINE_ENTRIES) {
    const tag = (match[1] ?? "").toLowerCase();
    const attributes = match[2] ?? "";
    if (tag === "style" || tag === "script") {
      const close = html.toLowerCase().indexOf(`</${tag}>`, tagPattern.lastIndex);
      if (close > 0) tagPattern.lastIndex = close + tag.length + 3;
      match = tagPattern.exec(html);
      continue;
    }
    const id = attributeValue(attributes, "id")?.trim() ?? "";
    const classes = (attributeValue(attributes, "class") ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 4);
    if (id.length > 0 || classes.length > 0) {
      const name = `${tag}${id.length > 0 ? `#${id}` : ""}${classes.map((value) => `.${value}`).join("")}`;
      const bounded = name.slice(0, MAX_OUTLINE_VALUE_CHARS);
      if (!seen.has(bounded)) {
        seen.add(bounded);
        outline.push(bounded);
      }
    }
    match = tagPattern.exec(html);
  }
  return outline;
}

export function htmlStyles(html: string): { css: string; truncated: boolean } {
  const blocks: string[] = [];
  const stylePattern = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  for (let match = stylePattern.exec(html); match !== null; match = stylePattern.exec(html)) {
    blocks.push((match[1] ?? "").trim());
  }
  const css = blocks.filter((block) => block.length > 0).join("\n\n");
  return { css: css.slice(0, MAX_STYLE_CHARS), truncated: css.length > MAX_STYLE_CHARS };
}

function cssFence(css: string): string {
  let ticks = "```";
  while (css.includes(ticks)) ticks += "`";
  return `${ticks}css\n${css}\n${ticks}`;
}

export function htmlToMarkdown(html: string): {
  markdown: string;
  removed: number;
  styles: { css: string; truncated: boolean };
  outline: string[];
} {
  const removed =
    (html.match(/<script\b/gi)?.length ?? 0) + (html.match(/<iframe\b/gi)?.length ?? 0);
  const outline = htmlOutline(html);
  const styles = htmlStyles(html);
  const clean = sanitizeHtml(html, {
    allowedTags: [
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "p",
      "br",
      "hr",
      "strong",
      "em",
      "b",
      "i",
      "u",
      "s",
      "del",
      "code",
      "pre",
      "blockquote",
      "ul",
      "ol",
      "li",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "a",
      "img",
    ],
    allowedAttributes: {
      a: ["href"],
      img: ["alt"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    nonTextTags: ["script", "style", "textarea", "option", "noscript"],
    disallowedTagsMode: "discard",
  });

  const parts = [turndown.turndown(clean).trim()];
  if (styles.css.length > 0) {
    parts.push(`## Embedded styles\n\n${cssFence(styles.css)}`);
  }
  if (outline.length > 0) {
    parts.push(`## Structure outline\n\n${outline.map((entry) => `- ${entry}`).join("\n")}`);
  }
  return {
    markdown: parts.filter((part) => part.length > 0).join("\n\n"),
    removed,
    styles,
    outline,
  };
}

export const htmlExtractor: DocumentExtractor = {
  id: "html",
  version: "2",
  supports: (mime) => mime === "text/html",
  async extract(input: ExtractInput): Promise<ExtractedAttachment> {
    const html = new TextDecoder("utf-8", { fatal: false })
      .decode(input.bytes)
      .replace(/^\uFEFF/, "");
    const { markdown, removed, styles } = htmlToMarkdown(html);
    const warnings: string[] = [];
    if (removed > 0) {
      warnings.push(
        `removed ${removed} script/iframe block(s); read view=source for the original HTML`,
      );
    }
    if (styles.truncated) {
      warnings.push(`embedded CSS truncated at ${MAX_STYLE_CHARS} characters`);
    }
    return finishExtraction(input, {
      markdown,
      method: "native",
      pageCount: null,
      warnings,
      extractor: { id: this.id, version: this.version },
    });
  },
};
