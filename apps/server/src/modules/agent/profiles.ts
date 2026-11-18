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
    process: pack("process", "后台进程", ["start_process", "read_process_output", "stop_process"]),
    service: pack("service", "服务", [
      "start_service",
      "read_service_logs",
      "stop_service",
      "register_temporary_service",
      "resolve_service_preview",
      "list_services",
    ]),
    observation: pack("observation", "观察", ["refresh_observations"]),
  },
  profiles: {
    coding: profile("coding", "Coding", ["core.read", "core.write", "core.command"]),
    plan: profile("plan", "Plan", ["core.read", "plan"]),
    workspace: profile("workspace", "Workspace", [
      "core.read",
      "core.write",
      "core.command",
      "process",
      "service",
      "observation",
    ]),
  },
};

/** Until K-9 wires the persisted session profile, production keeps the old tool surface. */
export const DEFAULT_AGENT_PROFILE: AgentProfileId = "coding";

export function toolNamesForProfile(profileId: AgentProfileId): ReadonlySet<string> {
  return profileToolNames(TOOL_PACK_CATALOG, profileId);
}

export function profileHasPack(profileId: AgentProfileId, packId: ToolPackId): boolean {
  return TOOL_PACK_CATALOG.profiles[profileId].packs.includes(packId);
}
