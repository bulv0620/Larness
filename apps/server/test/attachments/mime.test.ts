import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { inspectZip, sniffAttachment } from "../../src/modules/attachments/mime.js";

async function zip(files: Record<string, string>): Promise<Buffer> {
  const archive = new JSZip();
  for (const [name, content] of Object.entries(files)) archive.file(name, content);
  return Buffer.from(await archive.generateAsync({ type: "nodebuffer" }));
}

describe("attachment MIME sniffing", () => {
  it("detects approved image and PDF signatures", () => {
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    expect(sniffAttachment(png, null, "x").mime).toBe("image/png");
    expect(sniffAttachment(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), null, "x").mime).toBe(
      "image/jpeg",
    );
    expect(sniffAttachment(Buffer.from("RIFF0000WEBPVP8 ", "ascii"), null, "x").mime).toBe(
      "image/webp",
    );
    expect(sniffAttachment(Buffer.from("%PDF-1.7\n", "ascii"), null, "x").mime).toBe(
      "application/pdf",
    );
  });

  it("uses OOXML package contents instead of the extension", async () => {
    const docx = await zip({
      "[Content_Types].xml": "<Types/>",
      "word/document.xml": "<w:document/>",
    });
    expect(sniffAttachment(docx, "application/zip", "disguised.txt").mime).toContain(
      "wordprocessingml",
    );
  });

  it("rejects poisoned file names and unsupported containers", async () => {
    expect(() => sniffAttachment(Buffer.from("text"), null, "run.exe")).toThrow(/not supported/);
    expect(() => sniffAttachment(Buffer.from("text"), null, "archive.zip")).toThrow(
      /not supported/,
    );
    const poisoned = await zip({
      "[Content_Types].xml": "<Types/>",
      "../escape.xml": "<x/>",
    });
    expect(() => inspectZip(poisoned)).toThrow(/unsafe path/);
  });

  it("rejects archives that expand past the limit", async () => {
    const archive = await zip({
      "[Content_Types].xml": "<Types/>",
      "word/document.xml": "x".repeat(4_096),
    });
    expect(() =>
      inspectZip(archive, {
        maxEntries: 10,
        maxEntryUncompressed: 100,
        maxTotalUncompressed: 1_000,
      }),
    ).toThrow(/too large/);
  });
});
