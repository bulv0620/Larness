import {
  type AgentProfile,
  type AgentProfileId,
  profileToolNames,
  type ToolPack,
  type ToolPackCatalog,
  type ToolPackId,
} from "@larness/agent";

const pack = (id: ToolPackId, label: string, tools: readonly string[]): ToolPack => ({
  id,
  label,
  tools,
});

const profile = (
  id: AgentProfileId,
  label: string,
  packs: readonly ToolPackId[],
): AgentProfile => ({ id, label, packs });

/**
 * Concrete tool catalog for the current server. Names are the source of truth
 * for profile filtering; registration stays in `bootstrap/start.ts` so this
 * module has no database, secret or resource dependencies.
 */
export const TOOL_PACK_CATALOG: ToolPackCatalog = {
  packs: {
    "core.read": pack("core.read", "核心读取", ["list_files", "read_file", "search_code"]),
    "core.write": pack("core.write", "核心写入", ["write_file", "apply_patch"]),
    "core.command": pack("core.command", "核心命令", ["run_command", "run_shell"]),
    plan: pack("plan", "计划", ["update_plan"]),
    process: pack("process", "后台进程", [
      "start_process",
      "list_processes",
      "read_process_output",
      "stop_process",
    ]),
    observation: pack("observation", "观察", ["refresh_observations"]),
    serviceOps: pack("serviceOps", "服务运维", [
      "list_service_ops",
      "read_service_ops_logs",
      "control_service_ops",
    ]),
    memory: pack("memory", "项目记忆", ["remember", "read_memory"]),
  },
  profiles: {
    coding: profile("coding", "Coding", [
      "core.read",
      "core.write",
      "core.command",
      "process",
      "serviceOps",
      "memory",
    ]),
    plan: profile("plan", "Plan", [
      "core.read",
      "core.write",
      "core.command",
      "process",
      "serviceOps",
      "memory",
      "plan",
    ]),
  },
};

/** Until K-9 wires the persisted session profile, production keeps the old tool surface. */
export const DEFAULT_AGENT_PROFILE: AgentProfileId = "coding";

export function toolNamesForProfile(profileId: AgentProfileId): ReadonlySet<string> {
  return profileToolNames(TOOL_PACK_CATALOG, profileId);
}

/** Every tool name owned by the catalog. Tools outside it are extension/test tools. */
export const PROFILE_GATED_TOOL_NAMES: ReadonlySet<string> = new Set(
  Object.values(TOOL_PACK_CATALOG.packs).flatMap((pack) => pack.tools),
);

/**
 * Catalog tools the profile must not execute. Custom tools that are not part
 * of any pack stay available, so tests and future extensions are not blocked
 * by the profile catalog while every built-in gated tool fails closed.
 */
export function disabledToolsForProfile(profileId: AgentProfileId): ReadonlySet<string> {
  const allowed = toolNamesForProfile(profileId);
  const disabled = new Set<string>();
  for (const name of PROFILE_GATED_TOOL_NAMES) {
    if (!allowed.has(name)) disabled.add(name);
  }
  return disabled;
}

export function profileHasPack(profileId: AgentProfileId, packId: ToolPackId): boolean {
  return TOOL_PACK_CATALOG.profiles[profileId].packs.includes(packId);
}
