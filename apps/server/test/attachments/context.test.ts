import { mkdir } from "node:fs/promises";
import path from "node:path";
import { ToolRegistry } from "@larness/agent";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { assembleContext } from "../../src/modules/agent/contextAssembler.js";
import { AttachmentService } from "../../src/modules/attachments/service.js";
import { AttachmentStorage } from "../../src/modules/attachments/storage.js";
import { getTurnById } from "../../src/modules/sessions/repository.js";
import { createSession } from "../../src/modules/sessions/service.js";
import { createTurn } from "../../src/modules/sessions/turns.js";
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
  return { opened, dataDir, service, session };
}

describe("attachment context assembly", () => {
  it("inlines a small document for a text-only model", async () => {
    await withTempDir(async (dir) => {
      const { opened, service, session } = await setup(dir);
      try {
        const upload = await service.upload(session.id, {
          filename: "spec.md",
          mime: "text/markdown",
          data: Buffer.from("# Spec\n\nThe pipeline must stay bounded.").toString("base64"),
        });
        const turn = createTurn(
          { db: opened.db },
          { sessionId: session.id, text: "总结", attachmentIds: [upload.attachment.id] },
        );
        const row = getTurnById(opened.db, turn.turnId);
        if (row === null) throw new Error("turn row missing");
        expect(row).not.toBeNull();
        const context = assembleContext(
          {
            db: opened.db,
            registry: new ToolRegistry(),
            maxContextTokens: 128_000,
            policy: "standard",
            attachments: service,
            modelAcceptsImages: false,
          },
          session,
          row,
        );
        const user = context.messages.find((message) => message.role === "user");
        expect(user?.content).toContain('<attachment id="att_');
        expect(user?.content).toContain("The pipeline must stay bounded.");
        expect(user && "images" in user ? user.images : undefined).toBeUndefined();

        const event = opened.sqlite
          .prepare("SELECT payload_json FROM agent_events WHERE type = 'user.message'")
          .get() as { payload_json: string };
        expect(JSON.parse(event.payload_json).attachments[0]).toMatchObject({
          id: upload.attachment.id,
          filename: "spec.md",
          kind: "document",
        });
      } finally {
        opened.close();
      }
    });
  });

  it("injects only a directory for a document over the inline budget", async () => {
    await withTempDir(async (dir) => {
      const { opened, service, session } = await setup(dir);
      try {
        const body = Array.from(
          { length: 2_000 },
          (_, index) => `line ${index} with some words`,
        ).join("\n");
        const upload = await service.upload(session.id, {
          filename: "long.txt",
          mime: "text/plain",
          data: Buffer.from(body).toString("base64"),
        });
        const turn = createTurn(
          { db: opened.db },
          { sessionId: session.id, text: "find a line", attachmentIds: [upload.attachment.id] },
        );
        const row = getTurnById(opened.db, turn.turnId);
        if (row === null) throw new Error("turn row missing");
        const context = assembleContext(
          {
            db: opened.db,
            registry: new ToolRegistry(),
            maxContextTokens: 128_000,
            policy: "standard",
            attachments: service,
            modelAcceptsImages: false,
          },
          session,
          row,
        );
        const user = context.messages.find((message) => message.role === "user");
        expect(user?.content).toContain("larger than the inline budget");
        expect(user?.content).not.toContain("line 1999");
      } finally {
        opened.close();
      }
    });
  });

  it("injects text-like attachments as their original source", async () => {
    await withTempDir(async (dir) => {
      const { opened, service, session } = await setup(dir);
      try {
        const html = [
          "<!doctype html>",
          "<html><head><style>.card { display: flex; }</style></head>",
          '<body><div id="app" class="shell"><section class="card">Total</section></div></body>',
          "</html>",
        ].join("\n");
        const upload = await service.upload(session.id, {
          filename: "page.html",
          mime: "text/html",
          data: Buffer.from(html).toString("base64"),
        });
        const turn = createTurn(
          { db: opened.db },
          { sessionId: session.id, text: "改一下样式", attachmentIds: [upload.attachment.id] },
        );
        const row = getTurnById(opened.db, turn.turnId);
        if (row === null) throw new Error("turn row missing");
        const context = assembleContext(
          {
            db: opened.db,
            registry: new ToolRegistry(),
            maxContextTokens: 128_000,
            policy: "standard",
            attachments: service,
            modelAcceptsImages: false,
          },
          session,
          row,
        );
        const user = context.messages.find((message) => message.role === "user");
        expect(user?.content).toContain('view="source"');
        expect(user?.content).toContain(".card { display: flex; }");
        expect(user?.content).toContain('<div id="app" class="shell">');
        expect(user?.content).toContain("read_attachment view=source line:N");
      } finally {
        opened.close();
      }
    });
  });

  it("passes WebP images through to a vision model", async () => {
    await withTempDir(async (dir) => {
      const { opened, service, session } = await setup(dir);
      try {
        const webp = Buffer.concat([
          Buffer.from("RIFF"),
          Buffer.from([16, 0, 0, 0]),
          Buffer.from("WEBPVP8 "),
          Buffer.alloc(8),
        ]);
        const upload = await service.upload(session.id, {
          filename: "shot.webp",
          mime: "image/webp",
          data: webp.toString("base64"),
        });
        expect(upload.attachment.mime).toBe("image/webp");
        const turn = createTurn({ db: opened.db }, { sessionId: session.id, text: "看图" });
        opened.sqlite
          .prepare("UPDATE turns SET input_json = ? WHERE id = ?")
          .run(
            JSON.stringify({ text: "看图", attachmentIds: [upload.attachment.id] }),
            turn.turnId,
          );
        const row = getTurnById(opened.db, turn.turnId);
        if (row === null) throw new Error("turn row missing");
        const context = assembleContext(
          {
            db: opened.db,
            registry: new ToolRegistry(),
            maxContextTokens: 128_000,
            policy: "standard",
            attachments: service,
            modelAcceptsImages: true,
          },
          session,
          row,
        );
        const user = context.messages.find((message) => message.role === "user");
        expect(user && "images" in user ? user.images?.[0]?.mediaType : undefined).toBe(
          "image/webp",
        );
      } finally {
        opened.close();
      }
    });
  });
});
