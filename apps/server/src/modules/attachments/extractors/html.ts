import sanitizeHtml from "sanitize-html";
import TurndownService from "turndown";
import type { DocumentExtractor, ExtractedAttachment, ExtractInput } from "../types.js";
import { finishExtraction } from "./common.js";

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

export function htmlToMarkdown(html: string): { markdown: string; removed: number } {
  const removed =
    (html.match(/<script\b/gi)?.length ?? 0) + (html.match(/<iframe\b/gi)?.length ?? 0);
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
  return { markdown: turndown.turndown(clean), removed };
}

export const htmlExtractor: DocumentExtractor = {
  id: "html",
  version: "1",
  supports: (mime) => mime === "text/html",
  async extract(input: ExtractInput): Promise<ExtractedAttachment> {
    const html = new TextDecoder("utf-8", { fatal: false })
      .decode(input.bytes)
      .replace(/^\uFEFF/, "");
    const { markdown, removed } = htmlToMarkdown(html);
    return finishExtraction(input, {
      markdown,
      method: "native",
      pageCount: null,
      warnings: removed > 0 ? [`removed ${removed} script/iframe block(s)`] : [],
      extractor: { id: this.id, version: this.version },
    });
  },
};
