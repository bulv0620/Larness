/**
 * Profile / ToolPack boundaries for the agent kernel.
 *
 * The kernel only needs to know which tool names a profile may expose. The
 * server owns the concrete catalog because tool construction needs project,
 * database and secret dependencies. Keeping the types here prevents the
 * kernel from importing server storage or adapters.
 */
export type AgentProfileId = "coding" | "plan";

export type ToolPackId =
  | "core.read"
  | "core.write"
  | "core.command"
  | "plan"
  | "process"
  | "observation"
  | "serviceOps"
  | "memory"
  | "web"
  | "attachments";

export type ToolAvailability = "enabled" | "project-required" | "disabled";

export interface ToolPack {
  readonly id: ToolPackId;
  readonly label: string;
  readonly tools: readonly string[];
}

export interface AgentProfile {
  readonly id: AgentProfileId;
  readonly label: string;
  readonly packs: readonly ToolPackId[];
}

export interface ToolPackCatalog {
  readonly packs: Readonly<Record<ToolPackId, ToolPack>>;
  readonly profiles: Readonly<Record<AgentProfileId, AgentProfile>>;
}

export function profileToolNames(
  catalog: ToolPackCatalog,
  profile: AgentProfileId,
): ReadonlySet<string> {
  const entry = catalog.profiles[profile];
  if (entry === undefined) {
    throw new Error(`unknown agent profile: ${profile}`);
  }

  const names = new Set<string>();

  for (const packId of entry.packs) {
    const pack = catalog.packs[packId];
    if (pack === undefined) {
      throw new Error(`unknown tool pack: ${packId}`);
    }
    for (const tool of pack.tools) {
      names.add(tool);
    }
  }

  return names;
}

export function toolAvailability(
  catalog: ToolPackCatalog,
  profile: AgentProfileId,
  toolName: string,
  requiresProject: boolean,
): ToolAvailability {
  if (!profileToolNames(catalog, profile).has(toolName)) {
    return "disabled";
  }

  return requiresProject ? "project-required" : "enabled";
}
