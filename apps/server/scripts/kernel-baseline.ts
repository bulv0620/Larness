/**
 * K-1 baseline for the 082 agent-kernel refactor. Read-only with respect to
 * product data: the optional `LARNESS_BASELINE_DATA_DIR` is opened in SQLite
 * read-only mode and is never written. Tool/prompt numbers come from a fresh
 * temporary database so the same output can be reproduced on any machine.
 */
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { type AgentProfileId, createFileToolRegistry, type ToolSchema } from "@larness/agent";
import BetterSqlite3 from "better-sqlite3";
import { z } from "zod";
import { openDatabase } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";
import { createCommandTool, createShellTool } from "../src/modules/agent/commandTool.js";
import { assembleContext, PROMPT_VERSION } from "../src/modules/agent/contextAssembler.js";
import { createObservationTool } from "../src/modules/agent/observationTool.js";
import { createPlanTool } from "../src/modules/agent/planTool.js";
import { createProcessTools } from "../src/modules/agent/processTool.js";
import { toolNamesForProfile } from "../src/modules/agent/profiles.js";
import { estimateTextTokens } from "../src/modules/agent/tokenEstimator.js";
import { createProject } from "../src/modules/projects/service.js";
import { getSessionById, getTurnById } from "../src/modules/sessions/repository.js";
import { createSession } from "../src/modules/sessions/service.js";
import { createTurn } from "../src/modules/sessions/turns.js";

interface ToolBaseline {
  name: string;
  riskLevel: string;
  requiresProject: boolean;
  requiresProjectLock: boolean;
  schemaTokens: number;
  schemaBytes: number;
}

interface UsageBaseline {
  database: string;
  turns: number;
  turnsWithEvents: number;
  turnsWithPlan: number;
  planTriggerRate: number;
  toolCalls: Record<string, number>;
  aiTerminals: number;
  services: number;
  commandExecutions: number;
  commandStatus: Record<string, number>;
  limitation: string;
  omitted: string[];
}

function toolSummaries(
  registry: ReturnType<typeof createFileToolRegistry>,
  profile: AgentProfileId,
): ToolBaseline[] {
  const allowed = toolNamesForProfile(profile);
  return registry
    .list()
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap(({ name }) => {
      if (!allowed.has(name)) return [];
      const tool = registry.get(name);
      if (!tool) return [];
      const schema = {
        name: tool.name,
        description: tool.description,
        parameters: z.toJSONSchema(tool.schema, { io: "input" }) as Record<string, unknown>,
      } satisfies ToolSchema;
      const json = JSON.stringify(schema);
      return [
        {
          name: tool.name,
          riskLevel: tool.riskLevel,
          requiresProject: tool.requiresProject ?? false,
          requiresProjectLock: tool.requiresProjectLock ?? true,
          schemaTokens: estimateTextTokens(json) + 4,
          schemaBytes: Buffer.byteLength(json, "utf8"),
        },
      ];
    });
}

function systemSections(system: string): Array<{ label: string; tokens: number; bytes: number }> {
  return system.split("\n\n").map((block) => {
    const firstLine = block.split("\n", 1)[0] ?? "";
    return {
      label: firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine,
      tokens: estimateTextTokens(block),
      bytes: Buffer.byteLength(block, "utf8"),
    };
  });
}

async function freshWorkspaceNumbers(profile: AgentProfileId) {
  const dir = await mkdtemp(path.join(tmpdir(), "larness-082-baseline-"));
  const dbPath = path.join(dir, "larness.db");
  const opened = openDatabase(dbPath);
  try {
    runMigrations(opened.db);
    const root = path.join(dir, "project");
    await mkdir(root);
    const project = await createProject(
      { db: opened.db, detectGit: async () => false },
      { rootPath: root },
    );
    const sessionOptions = { db: opened.db, dataDir: dir };
    const session = await createSession(sessionOptions, { projectId: project.id });
    const created = createTurn(sessionOptions, {
      sessionId: session.id,
      text: "baseline request",
    });
    const sessionRow = getSessionById(opened.db, session.id);
    const turn = getTurnById(opened.db, created.turnId);
    if (!sessionRow || !turn) throw new Error("baseline fixture missing");

    const registry = createFileToolRegistry();
    for (const tool of [
      createPlanTool({ db: opened.db }),
      createCommandTool({}),
      createShellTool({}),
      ...createProcessTools({}),
      createObservationTool(),
    ]) {
      registry.register(tool);
    }

    const assembled = assembleContext(
      {
        db: opened.db,
        registry,
        maxContextTokens: 128_000,
        policy: "standard",
        agentProfile: profile,
      },
      sessionRow,
      turn,
    );

    const system = assembled.messages[0];
    if (system?.role !== "system") throw new Error("missing system message");

    const tools = toolSummaries(registry, profile);

    return {
      profile,
      tools,
      toolCount: tools.length,
      toolSchemaTokens: tools.reduce((sum, tool) => sum + tool.schemaTokens, 0),
      toolSchemaBytes: tools.reduce((sum, tool) => sum + tool.schemaBytes, 0),
      promptVersion: PROMPT_VERSION,
      systemTokens: estimateTextTokens(system.content),
      systemBytes: Buffer.byteLength(system.content, "utf8"),
      systemSections: systemSections(system.content),
      assembledTokens: assembled.estimatedTokens,
    };
  } finally {
    opened.close();
    await rm(dir, { recursive: true, force: true });
  }
}

function usageBaseline(dataDir: string): UsageBaseline | null {
  const dbPath = path.join(dataDir, "larness.db");
  let db: BetterSqlite3.Database | null = null;

  try {
    db = new BetterSqlite3(dbPath, { readonly: true, fileMustExist: true });
    const one = (sql: string): number => {
      const row = db?.prepare(sql).get() as { n?: number } | undefined;
      return typeof row?.n === "number" ? row.n : 0;
    };
    const turns = one("SELECT COUNT(*) AS n FROM turns");
    const turnsWithEvents = one(
      "SELECT COUNT(DISTINCT turn_id) AS n FROM agent_events WHERE turn_id IS NOT NULL",
    );
    const turnsWithPlan = one(
      "SELECT COUNT(DISTINCT turn_id) AS n FROM agent_events WHERE type = 'plan.updated' AND turn_id IS NOT NULL",
    );
    const names = db
      .prepare("SELECT payload_json AS payload FROM agent_events WHERE type = 'tool.requested'")
      .all() as Array<{ payload: string }>;
    const toolCalls: Record<string, number> = {};
    for (const row of names) {
      try {
        const payload = JSON.parse(row.payload) as { name?: unknown };
        if (typeof payload.name === "string") {
          toolCalls[payload.name] = (toolCalls[payload.name] ?? 0) + 1;
        }
      } catch {
        /* Ignore malformed historical payloads instead of failing the report. */
      }
    }
    const commandStatusRows = db
      .prepare("SELECT status, COUNT(*) AS n FROM command_executions GROUP BY status")
      .all() as Array<{ status: string; n: number }>;
    const commandStatus = Object.fromEntries(commandStatusRows.map((row) => [row.status, row.n]));
    return {
      database: dbPath,
      turns,
      turnsWithEvents,
      turnsWithPlan,
      planTriggerRate: turns === 0 ? 0 : turnsWithPlan / turns,
      toolCalls,
      aiTerminals: one("SELECT COUNT(*) AS n FROM terminals WHERE created_by_turn_id IS NOT NULL"),
      services: one("SELECT COUNT(*) AS n FROM services"),
      commandExecutions: one("SELECT COUNT(*) AS n FROM command_executions"),
      commandStatus,
      limitation:
        "command_executions stores params_hash only; executable/args and test/build share are not persisted, so they cannot be derived from historical data.",
      omitted: [
        "raw command args",
        "raw tool args",
        "secrets",
        "command output",
        "project file contents",
      ],
    };
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

const profiles = Object.fromEntries(
  await Promise.all(
    (["coding", "plan"] as const).map(async (profile) => [
      profile,
      await freshWorkspaceNumbers(profile),
    ]),
  ),
);
const report = {
  generatedAt: new Date().toISOString(),
  profiles,
  usage:
    process.env.LARNESS_BASELINE_DATA_DIR === undefined
      ? null
      : usageBaseline(process.env.LARNESS_BASELINE_DATA_DIR),
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
