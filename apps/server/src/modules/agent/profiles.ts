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
    "core.command": pack("core.command", "核心命令", ["run_command"]),
    plan: pack("plan", "计划", ["update_plan"]),
    git: pack("git", "Git", [
      "git_status",
      "git_diff",
      "git_log",
      "git_branches",
      "git_add",
      "git_commit",
      "git_create_branch",
      "git_switch_branch",
      "git_pull",
      "git_push",
    ]),
    terminal: pack("terminal", "终端", [
      "start_project_terminal",
      "read_terminal_output",
      "stop_project_terminal",
      "acquire_terminal_control",
      "send_terminal_input",
      "interrupt_terminal",
      "release_terminal_control",
    ]),
    service: pack("service", "服务", [
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
      "plan",
      "git",
      "terminal",
      "service",
      "observation",
    ]),
  },
};

/** Until K-9 wires the persisted session profile, production keeps the old tool surface. */
export const DEFAULT_AGENT_PROFILE: AgentProfileId = "workspace";

export function toolNamesForProfile(profileId: AgentProfileId): ReadonlySet<string> {
  return profileToolNames(TOOL_PACK_CATALOG, profileId);
}
