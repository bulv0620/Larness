import { mkdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { AttachmentService } from "../../src/modules/attachments/service.js";
import { AttachmentStorage } from "../../src/modules/attachments/storage.js";
import { createAttachmentToolBridge } from "../../src/modules/attachments/tools.js";
import { createSession } from "../../src/modules/sessions/service.js";
import { withTempDir } from "../helpers.js";

async function setup(dir: string) {
  const opened = openDatabase(path.join(dir, "larness.db"));
  runMigrations(opened.db);
  const dataDir = path.join(dir, "data");
  await mkdir(dataDir, { recursive: true });
  const service = new AttachmentService({
    db: opened.db,
    storage: new AttachmentStorage(dataDir),
  });
  const session = await createSession({ db: opened.db, dataDir }, {});
  return { opened, service, session };
}

const HTML = [
  "<!doctype html>",
  "<html><head><style>.card { color: #c00; }</style></head>",
  '<body><div id="app" class="shell">',
  '<section class="card">Total: 42</section>',
  "</div></body></html>",
].join("\n");

describe("attachment tool bridge", () => {
  it("reads the original source of a text-like attachment by line", async () => {
    await withTempDir(async (dir) => {
      const { opened, service, session } = await setup(dir);
      try {
        const upload = await service.upload(session.id, {
          filename: "page.html",
          mime: "text/html",
          data: Buffer.from(HTML).toString("base64"),
        });
        expect(upload.attachment.status).toBe("ready");
        const bridge = createAttachmentToolBridge(service, session.id);

        const page = await bridge.readAttachment({
          attachmentId: upload.attachment.id,
          view: "source",
          maxChars: 2_000,
        });
        expect(page.ok).toBe(true);
        const data = page.data as {
          view: string;
          content: string;
          anchor: string;
          lineStart: number;
          totalLines: number;
        };
        expect(data.view).toBe("source");
        expect(data.content).toContain(".card { color: #c00; }");
        expect(data.content).toContain('class="shell"');
        expect(data.anchor).toBe("line:1");
        expect(data.lineStart).toBe(1);
        expect(data.totalLines).toBe(5);

        const second = await bridge.readAttachment({
          attachmentId: upload.attachment.id,
          view: "source",
          anchor: "line:3",
        });
        const secondData = second.data as { lineStart: number; content: string };
        expect(secondData.lineStart).toBe(3);
        expect(secondData.content.startsWith("<body><div")).toBe(true);

        // The parsed text view stays available and still loses the CSS.
        const parsed = await bridge.readAttachment({
          attachmentId: upload.attachment.id,
          view: "text",
        });
        const parsedData = parsed.data as { view: string; content: string };
        expect(parsedData.view).toBe("text");
        expect(parsedData.content).not.toContain('class="shell"');
      } finally {
        opened.close();
      }
    });
  });

  it("rejects the source view for attachments that only have parsed text", async () => {
    await withTempDir(async (dir) => {
      const { opened, service, session } = await setup(dir);
      try {
        const png = Buffer.from(
          "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489",
          "hex",
        );
        const upload = await service.upload(session.id, {
          filename: "shot.png",
          mime: "image/png",
          data: png.toString("base64"),
        });
        const bridge = createAttachmentToolBridge(service, session.id);
        const result = await bridge.readAttachment({
          attachmentId: upload.attachment.id,
          view: "source",
        });
        expect(result).toMatchObject({ ok: false, errorCode: "ATTACHMENT_VIEW_UNSUPPORTED" });
      } finally {
        opened.close();
      }
    });
  });

  it("searches across session attachments and points at source lines", async () => {
    await withTempDir(async (dir) => {
      const { opened, service, session } = await setup(dir);
      try {
        await service.upload(session.id, {
          filename: "styles.css",
          mime: "text/plain",
          data: Buffer.from(".a { color: red; }\n.needle { color: blue; }\n").toString("base64"),
        });
        await service.upload(session.id, {
          filename: "notes.md",
          mime: "text/markdown",
          data: Buffer.from("# Notes\n\nthe needle is here\n").toString("base64"),
        });
        const bridge = createAttachmentToolBridge(service, session.id);
        const result = await bridge.searchAttachment({ query: "needle" });
        expect(result.ok).toBe(true);
        const data = result.data as {
          hits: Array<{ filename: string; view: string; anchor: string; snippet: string }>;
          searched: unknown[];
        };
        expect(data.searched).toHaveLength(2);
        expect(data.hits).toHaveLength(2);
        const css = data.hits.find((hit) => hit.filename === "styles.css");
        expect(css?.view).toBe("source");
        expect(css?.anchor).toBe("line:2");
        const notes = data.hits.find((hit) => hit.filename === "notes.md");
        expect(notes?.view).toBe("source");
        expect(notes?.anchor).toBe("line:3");
      } finally {
        opened.close();
      }
    });
  });

  it("keeps the single-attachment search and lists available views", async () => {
    await withTempDir(async (dir) => {
      const { opened, service, session } = await setup(dir);
      try {
        const upload = await service.upload(session.id, {
          filename: "app.ts",
          mime: "text/plain",
          data: Buffer.from('const needle = "value";\n').toString("base64"),
        });
        const bridge = createAttachmentToolBridge(service, session.id);
        const result = await bridge.searchAttachment({
          attachmentId: upload.attachment.id,
          query: "needle",
        });
        expect(result.ok).toBe(true);
        expect((result.data as { hits: unknown[] }).hits).toHaveLength(1);

        const listed = await bridge.listAttachments({});
        const attachments = (listed.data as { attachments: Array<{ views: string[] }> })
          .attachments;
        expect(attachments[0]?.views).toEqual(["text", "source"]);
      } finally {
        opened.close();
      }
    });
  });

  it("rejects credential files and unknown text formats on upload", async () => {
    await withTempDir(async (dir) => {
      const { opened, service, session } = await setup(dir);
      try {
        await expect(
          service.upload(session.id, {
            filename: ".env",
            mime: "text/plain",
            data: Buffer.from("API_KEY=secret").toString("base64"),
          }),
        ).rejects.toMatchObject({ code: "ATTACHMENT_SECRET_FILE" });

        await expect(
          service.upload(session.id, {
            filename: "notes.weirdtext",
            mime: "text/plain",
            data: Buffer.from("plain").toString("base64"),
          }),
        ).rejects.toMatchObject({ code: "ATTACHMENT_UNSUPPORTED" });
      } finally {
        opened.close();
      }
    });
  });
});
