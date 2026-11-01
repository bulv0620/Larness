import type { ToolContext, ToolDefinition, ToolResult } from "./types.js";

export interface ToolSummary {
  name: string;
  description: string;
  riskLevel: ToolDefinition["riskLevel"];
}

export class ToolRegistry {
  readonly #tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    if (tool.name.trim().length === 0) {
      throw new Error("tool name must not be empty");
    }

    if (this.#tools.has(tool.name)) {
      throw new Error(`tool already registered: ${tool.name}`);
    }

    this.#tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.#tools.get(name);
  }

  has(name: string): boolean {
    return this.#tools.has(name);
  }

  list(): ToolSummary[] {
    return [...this.#tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      riskLevel: tool.riskLevel,
    }));
  }

  async execute(name: string, rawArgs: unknown, context: ToolContext): Promise<ToolResult> {
    const tool = this.#tools.get(name);

    if (tool === undefined) {
      return {
        ok: false,
        errorCode: "TOOL_NOT_FOUND",
        summary: `unknown tool: ${name}`,
      };
    }

    try {
      return await tool.execute(rawArgs, context);
    } catch {
      return {
        ok: false,
        errorCode: "TOOL_ERROR",
        summary: `tool failed: ${name}`,
      };
    }
  }
}
