import { stripVTControlCharacters } from "node:util";
import stringWidth from "fast-string-width";
import { wrapAnsi } from "fast-wrap-ansi";

export interface ScreenFrame {
  title: string;
  body: string[];
  footer: string;
  offset?: number;
}

export function safeText(value: string): string {
  const text = stripVTControlCharacters(value.replace(/\r\n/g, "\n")).replace(/\t/g, "    ");
  return Array.from(text)
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code === 10 || (code >= 32 && (code < 127 || code > 159));
    })
    .join("");
}

export function clipLine(text: string, columns: number): string {
  let result = "";
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
    safeText(text).replace(/\n/g, " "),
  )) {
    if (stringWidth(result + segment) > columns) break;
    result += segment;
  }
  return result;
}

export function bodyLines(body: string[], columns: number): string[] {
  return body.flatMap((line) =>
    wrapAnsi(safeText(line), Math.max(1, columns - 1), {
      hard: true,
      wordWrap: false,
      trim: false,
    }).split("\n"),
  );
}

export function frameLines(frame: ScreenFrame, columns: number, rows: number): string[] {
  const width = Math.max(1, columns - 1);
  const height = Math.max(1, rows);
  if (columns < 80 || rows < 24) {
    return Array.from({ length: height }, (_, i) =>
      clipLine(
        i === 0
          ? "终端空间不足，请调整到至少 80×24"
          : i === height - 1
            ? "Esc 返回 · Ctrl+C 停止服务"
            : "",
        width,
      ),
    );
  }
  const content = bodyLines(frame.body, columns);
  const offset = Math.min(
    Math.max(0, frame.offset ?? 0),
    Math.max(0, content.length - (height - 4)),
  );
  return [
    clipLine(`Larness · ${frame.title}`, width),
    "─".repeat(width),
    ...Array.from({ length: height - 4 }, (_, i) => clipLine(content[offset + i] ?? "", width)),
    "─".repeat(width),
    clipLine(frame.footer, width),
  ];
}
