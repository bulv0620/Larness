import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { findMainLogFile } from "../log-files.js";
import { resolveDataDir } from "../platform/paths.js";
import { SERVER_VERSION } from "../version.js";
import {
  EXIT_FAILURE,
  EXIT_NOT_RUNNING,
  EXIT_OK,
  EXIT_USAGE,
  type ParsedCommand,
  parseArgs,
  UnknownCommandError,
  UsageError,
} from "./args.js";
import { formatLogLine, formatStatus } from "./format.js";
import { helpText } from "./help.js";
import { followLog, logFilePath, readLogTail } from "./logs.js";

export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
  env: NodeJS.ProcessEnv;
}

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return stripVTControlCharacters(message);
}

async function runStatus(parsed: ParsedCommand, io: CliIo): Promise<number> {
  const { readStatus } = await import("./status.js");
  const report = await readStatus({ dataDir: resolveDataDir(io.env), env: io.env });

  if (parsed.json) {
    io.stdout(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    io.stdout(formatStatus(report));
  }

  return report.running ? EXIT_OK : EXIT_NOT_RUNNING;
}

async function runLogs(parsed: ParsedCommand, io: CliIo): Promise<number> {
  const dataDir = resolveDataDir(io.env);
  const source = parsed.daemon ? "daemon" : "main";
  const file = parsed.daemon ? logFilePath(dataDir, "daemon") : await findMainLogFile(dataDir);

  if (file === null) {
    io.stderr(`[larness] no main log under ${path.join(dataDir, "logs")}\n`);
    return EXIT_NOT_RUNNING;
  }

  const tail = await readLogTail(file, { lines: parsed.lines });

  if (tail === null) {
    io.stderr(`[larness] no ${source === "daemon" ? "background" : "main"} log at ${file}\n`);
    return EXIT_NOT_RUNNING;
  }

  if (tail.truncated) {
    io.stderr(`[larness] showing the last ${parsed.lines} line(s) of ${file}\n`);
  }

  for (const line of tail.lines) {
    io.stdout(`${formatLogLine(line)}\n`);
  }

  if (!parsed.follow) return EXIT_OK;

  const abort = new AbortController();
  const onInterrupt = () => abort.abort();
  process.once("SIGINT", onInterrupt);

  try {
    const end = await followLog(file, (line) => io.stdout(`${formatLogLine(line)}\n`), {
      signal: abort.signal,
    });

    if (end === "missing") {
      io.stderr(`[larness] ${file} disappeared; stopped following.\n`);
      return EXIT_FAILURE;
    }

    if (end === "replaced") {
      io.stderr(`[larness] ${file} was truncated or replaced; stopped following.\n`);
      return EXIT_FAILURE;
    }

    return EXIT_OK;
  } finally {
    process.off("SIGINT", onInterrupt);
  }
}

async function runDoctorCommand(io: CliIo): Promise<number> {
  const { runDoctor } = await import("../doctor.js");
  const report = await runDoctor({ env: io.env });
  io.stdout(`${JSON.stringify(report, null, 2)}\n`);
  return report.checks.some((check) => check.status === "fail") ? EXIT_FAILURE : EXIT_OK;
}

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  let parsed: ParsedCommand;

  try {
    parsed = parseArgs(argv);
  } catch (error) {
    if (error instanceof UnknownCommandError) {
      io.stderr(`[larness] ${safeMessage(error)}\n`);
      io.stderr(`${helpText(SERVER_VERSION)}\n`);
      return EXIT_FAILURE;
    }

    if (error instanceof UsageError) {
      io.stderr(`[larness] ${safeMessage(error)}\n`);
      io.stderr("[larness] run `larness --help` for usage.\n");
      return EXIT_USAGE;
    }

    throw error;
  }

  try {
    switch (parsed.name) {
      case "help":
        io.stdout(`${helpText(SERVER_VERSION)}\n`);
        return EXIT_OK;
      case "version":
        io.stdout(`${SERVER_VERSION}\n`);
        return EXIT_OK;
      case "status":
        return await runStatus(parsed, io);
      case "logs":
        return await runLogs(parsed, io);
      case "doctor":
        return await runDoctorCommand(io);
      case "start": {
        const { startCommand } = await import("./lifecycle.js");
        return await startCommand(io);
      }
      case "stop": {
        const { stopCommand } = await import("./lifecycle.js");
        return await stopCommand(io);
      }
      case "restart": {
        const { restartCommand } = await import("./lifecycle.js");
        return await restartCommand(io);
      }
      case "tui": {
        const { tuiCommand } = await import("./lifecycle.js");
        return await tuiCommand(io);
      }
    }
  } catch (error) {
    io.stderr(`[larness] ${parsed.name} failed: ${safeMessage(error)}\n`);
    return EXIT_FAILURE;
  }
}
