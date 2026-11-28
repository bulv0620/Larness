export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;
export const EXIT_USAGE = 2;
export const EXIT_NOT_RUNNING = 3;

export type CommandName =
  | "start"
  | "stop"
  | "restart"
  | "tui"
  | "status"
  | "logs"
  | "doctor"
  | "help"
  | "version";

export interface ParsedCommand {
  name: CommandName;
  json: boolean;
  lines: number;
  daemon: boolean;
  follow: boolean;
}

export class UnknownCommandError extends Error {
  constructor(readonly command: string) {
    super(`unknown command: ${command}`);
    this.name = "UnknownCommandError";
  }
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

const COMMANDS = new Set<CommandName>([
  "start",
  "stop",
  "restart",
  "tui",
  "status",
  "logs",
  "doctor",
]);

const DEFAULT_LOG_LINES = 200;
export const MAX_LOG_LINES = 1_000;
export const MIN_LOG_LINES = 1;

function parseLines(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new UsageError(
      `--lines expects an integer between ${MIN_LOG_LINES} and ${MAX_LOG_LINES}`,
    );
  }

  const lines = Number(value);

  if (lines < MIN_LOG_LINES || lines > MAX_LOG_LINES) {
    throw new UsageError(
      `--lines expects an integer between ${MIN_LOG_LINES} and ${MAX_LOG_LINES}`,
    );
  }

  return lines;
}

export function parseArgs(argv: string[]): ParsedCommand {
  const [first, ...rest] = argv;

  if (first === undefined || first === "help" || first === "--help" || first === "-h") {
    if (rest.length > 0) {
      throw new UsageError(`unexpected arguments after help: ${rest.join(" ")}`);
    }
    return {
      name: "help",
      json: false,
      lines: DEFAULT_LOG_LINES,
      daemon: false,
      follow: false,
    };
  }

  if (first === "--version" || first === "-v") {
    if (rest.length > 0) {
      throw new UsageError("--version does not accept arguments");
    }
    return {
      name: "version",
      json: false,
      lines: DEFAULT_LOG_LINES,
      daemon: false,
      follow: false,
    };
  }

  if (!COMMANDS.has(first as CommandName)) {
    throw new UnknownCommandError(first);
  }

  const command = first as Exclude<CommandName, "help" | "version">;
  const parsed: ParsedCommand = {
    name: command,
    json: false,
    lines: DEFAULT_LOG_LINES,
    daemon: false,
    follow: false,
  };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index] ?? "";

    if (command === "status" && arg === "--json") {
      parsed.json = true;
      continue;
    }

    if (command === "logs" && arg === "--daemon") {
      parsed.daemon = true;
      continue;
    }

    if (command === "logs" && (arg === "--follow" || arg === "-f")) {
      parsed.follow = true;
      continue;
    }

    if (command === "logs" && (arg === "--lines" || arg.startsWith("--lines="))) {
      if (arg === "--lines") {
        const value = rest[index + 1];
        if (value === undefined) {
          throw new UsageError("--lines requires a value");
        }
        parsed.lines = parseLines(value);
        index += 1;
      } else {
        parsed.lines = parseLines(arg.slice("--lines=".length));
      }
      continue;
    }

    if (arg.startsWith("-")) {
      throw new UsageError(`unknown option for ${command}: ${arg}`);
    }

    throw new UsageError(`unexpected argument for ${command}: ${arg}`);
  }

  return parsed;
}
