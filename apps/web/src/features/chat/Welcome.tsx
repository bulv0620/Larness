import { ArrowUpRight, Bug, Code2, FolderSearch, Sparkles, WandSparkles } from "lucide-react";
import { useComposerStore } from "@/stores/composerStore";
import { useNavigationStore } from "@/stores/navigationStore";

const suggestions = [
  {
    label: "了解这个项目",
    text: "先帮我了解项目结构、主要功能和启动方式。",
    icon: FolderSearch,
    color: "bg-accent-soft text-accent",
  },
  {
    label: "一起排查问题",
    text: "帮我排查一个问题：",
    icon: Bug,
    color: "bg-warning/10 text-warning",
  },
  {
    label: "实现一个想法",
    text: "我想在这个项目中实现一个功能：",
    icon: Code2,
    color: "bg-success/10 text-success",
  },
  {
    label: "打磨现有体验",
    text: "看看这个项目有哪些值得改进的体验，先给我简短建议。",
    icon: WandSparkles,
    color: "bg-violet-500/10 text-violet-500",
  },
];
export function Welcome() {
  return (
    <section
      aria-label="开始新的任务"
      className="mx-auto flex min-h-[340px] max-w-[560px] flex-col justify-center py-8 sm:py-14"
    >
      <div className="relative mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-accent/15 bg-gradient-to-br from-accent-soft via-surface to-violet-500/10 text-accent shadow-sm">
        <Sparkles size={26} strokeWidth={1.6} />
        <span
          aria-hidden="true"
          className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-canvas bg-warning"
        />
      </div>
      <h2 className="text-[25px] font-semibold tracking-tight text-ink sm:text-[28px]">
        有什么想一起完成？
      </h2>
      <p className="mb-7 mt-2 text-[12px] leading-6 text-ink-3">
        从一个问题、一个想法，或眼前的项目开始。
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {suggestions.map(({ label, text, icon: Icon, color }) => (
          <button
            key={label}
            type="button"
            onClick={() => {
              useComposerStore.getState().setDraft(text);
              useNavigationStore.getState().focusComposer();
            }}
            className="group flex min-w-0 items-center gap-3 rounded-xl border border-line bg-surface/80 p-3 text-left shadow-sm transition-colors hover:border-accent/30 hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${color}`}
            >
              <Icon size={16} />
            </span>
            <span className="flex-1 text-[12px] font-medium text-ink-2">{label}</span>
            <ArrowUpRight
              size={13}
              className="text-ink-3 transition-colors group-hover:text-accent"
            />
          </button>
        ))}
      </div>
    </section>
  );
}
