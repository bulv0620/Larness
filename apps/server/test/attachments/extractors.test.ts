import ExcelJS from "exceljs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { extractAttachment, extractorRegistry } from "../../src/modules/attachments/extract.js";
import { DEFAULT_EXTRACT_LIMITS } from "../../src/modules/attachments/types.js";

const limits = { ...DEFAULT_EXTRACT_LIMITS, maxExtractedChars: 50_000 };

function extract(bytes: Buffer, mime: string, filename = "file") {
  return extractAttachment(extractorRegistry, { bytes, mime, filename, limits });
}

async function zip(files: Record<string, string>): Promise<Buffer> {
  const archive = new JSZip();
  for (const [name, content] of Object.entries(files)) archive.file(name, content);
  return Buffer.from(await archive.generateAsync({ type: "nodebuffer" }));
}

async function docx(): Promise<Buffer> {
  return zip({
    "[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    "word/document.xml": `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Project plan</w:t></w:r></w:p><w:p><w:r><w:t>Build the attachment pipeline.</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Owner</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Ada</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`,
    "word/styles.xml": `<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>`,
  });
}

async function pptx(): Promise<Buffer> {
  return zip({
    "[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`,
    "ppt/slides/slide1.xml": `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>First slide</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
    "ppt/slides/slide2.xml": `<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Second slide</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
    "ppt/notesSlides/notesSlide2.xml": `<p:notes xmlns:p="p" xmlns:a="a"><a:p><a:r><a:t>Speaker note</a:t></a:r></a:p></p:notes>`,
  });
}

function pdf(text: string): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${text.length + 40} >>\nstream\nBT /F1 12 Tf 72 720 Td (${text}) Tj ET\nendstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "utf8");
}

describe("attachment extractors", () => {
  it("extracts text and keeps markdown headings as anchors", async () => {
    const result = await extract(Buffer.from("# Title\n\nBody text"), "text/markdown", "notes.md");
    expect(result.method).toBe("native");
    expect(result.markdown).toContain("Body text");
    expect(result.sections[0]?.anchor).toBe("offset:0");
  });

  it("parses quoted CSV fields and renders a markdown table", async () => {
    const result = await extract(
      Buffer.from('name,note\nAda,"hello, world"\nLin,"line 1\nline 2"'),
      "text/csv",
      "data.csv",
    );
    expect(result.markdown).toContain("| name | note |");
    expect(result.markdown).toContain("hello, world");
    expect(result.markdown).toContain("line 1 line 2");
  });

  it("sanitizes scripts and remote images from HTML", async () => {
    const result = await extract(
      Buffer.from(
        '<html><body><h1>Hi</h1><script>alert(1)</script><img src="https://x.test/a.png" alt="chart"><p onclick="x()">Text</p></body></html>',
      ),
      "text/html",
      "page.html",
    );
    expect(result.markdown).toContain("# Hi");
    expect(result.markdown).not.toContain("alert(1)");
    expect(result.markdown).not.toContain("https://x.test");
    expect(result.markdown).toContain("[image: chart]");
  });

  it("extracts DOCX headings and tables", async () => {
    const result = await extract(
      await docx(),
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "plan.docx",
    );
    expect(result.markdown).toContain("# Project plan");
    expect(result.markdown).toContain("Build the attachment pipeline.");
    expect(result.markdown).toContain("Ada");
    expect(result.extractor.id).toBe("mammoth");
  });

  it("extracts PPTX slides in order with notes", async () => {
    const result = await extract(
      await pptx(),
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "deck.pptx",
    );
    expect(result.pageCount).toBe(2);
    expect(result.markdown.indexOf("First slide")).toBeLessThan(
      result.markdown.indexOf("Second slide"),
    );
    expect(result.markdown).toContain("Speaker note");
  });

  it("extracts XLSX sheets and uses cached formula results", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Budget");
    sheet.addRow(["Item", "Cost"]);
    sheet.addRow(["Hosting", 12]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const result = await extract(
      buffer,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "budget.xlsx",
    );
    expect(result.markdown).toContain("## Sheet: Budget");
    expect(result.markdown).toContain("Hosting");
    expect(result.pageCount).toBe(1);
  });

  it("extracts a text PDF with page anchors", async () => {
    const result = await extract(pdf("Hello attachment page"), "application/pdf", "doc.pdf");
    expect(result.method).toBe("text-layer");
    expect(result.pageCount).toBe(1);
    expect(result.markdown).toContain("<!-- page: 1 -->");
    expect(result.markdown).toContain("Hello attachment page");
  });

  it("rejects an unsupported mime type", async () => {
    await expect(extract(Buffer.from("x"), "application/zip", "a.zip")).rejects.toMatchObject({
      code: "ATTACHMENT_UNSUPPORTED",
    });
  });
});
