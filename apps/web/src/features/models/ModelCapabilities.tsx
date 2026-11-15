import { Hint } from "@larness/ui";
import { Brain, Image, Wrench } from "lucide-react";
import type { ApiCatalogModel } from "@/lib/workspaceApi";

const compactTokens = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function windowCapability(model: ApiCatalogModel) {
  if (model.contextWindow !== null) return { tokens: model.contextWindow, label: "上下文窗口" };
  const tokens = model.capabilities?.maxInputTokens;
  return tokens === undefined ? undefined : { tokens, label: "最大输入" };
}

function thinkingCapability(model: ApiCatalogModel) {
  if (!model.thinking.supported) return undefined;
  if (model.thinking.mode === "toggle") return "思考可开启或关闭";
  const levels = model.thinking.levels.map((level) => level.label).join("、");
  return levels ? `思考档位：${levels}` : "可调思考档位";
}

export function modelCapabilityDetails(model: ApiCatalogModel): string {
  const inputs = model.capabilities?.inputModalities;
  const tools = model.capabilities?.tools;
  const window = windowCapability(model);
  return [
    inputs === undefined ? "截图能力未知" : inputs.includes("image") ? "支持截图" : "不支持截图",
    tools === undefined ? "工具能力未知" : tools ? "支持工具调用" : "不支持工具调用",
    thinkingCapability(model) ?? "无可调思考档位",
    window ? `${window.label} ${window.tokens.toLocaleString("zh-CN")} token` : "未声明上下文窗口",
  ].join(" · ");
}

export function ModelCapabilities({ model }: { model: ApiCatalogModel }) {
  const window = windowCapability(model);
  const thinking = thinkingCapability(model);
  const visuals = model.capabilities?.inputModalities?.includes("image");
  const tools = model.capabilities?.tools;
  if (!window && !thinking && !visuals && !tools) return null;

  const description = modelCapabilityDetails(model);
  return (
    <Hint label={description} side="top" className="z-[320] max-w-[240px] leading-relaxed">
      <span
        role="img"
        aria-label={description}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: focus reveals the same capability hint as hover.
        tabIndex={0}
        className="inline-flex shrink-0 items-center gap-1.5 rounded px-1 text-ink-3 outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        {visuals ? <Image size={13} aria-hidden="true" /> : null}
        {tools ? <Wrench size={13} aria-hidden="true" /> : null}
        {thinking ? <Brain size={13} aria-hidden="true" /> : null}
        {window ? (
          <span aria-hidden="true" className="font-mono text-[10px] tabular-nums">
            {compactTokens.format(window.tokens)}
          </span>
        ) : null}
      </span>
    </Hint>
  );
}
