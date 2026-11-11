import { Bug, Code2, FolderSearch, Sparkles } from "lucide-react";
import { useComposerStore } from "@/stores/composerStore";
import { useNavigationStore } from "@/stores/navigationStore";

const suggestions = [
  {
    label: "了解项目",
    text: "先帮我了解项目结构、主要功能和启动方式。",
    icon: FolderSearch,
    color: "text-accent",
  },
  {
    label: "排查问题",
    text: "帮我排查一个问题：",
    icon: Bug,
    color: "text-warning",
  },
  {
    label: "实现功能",
    text: "我想在这个项目中实现一个功能：",
    icon: Code2,
    color: "text-success",
  },
];

export function WelcomeHeading() {
  return (
    <div className="mb-5 flex flex-col items-center gap-3 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-accent/20 bg-gradient-to-br from-accent-soft to-surface text-accent">
        <Sparkles size={20} strokeWidth={1.7} aria-hidden="true" />
      </div>
      <h2 className="text-[23px] font-semibold tracking-tight text-ink sm:text-[27px]">
        今天想做什么？
      </h2>
    </div>
  );
}

export function WelcomeSuggestions() {
  return (
    <section aria-label="建议任务" className="mt-3 flex flex-wrap justify-center gap-2">
      {suggestions.map(({ label, text, icon: Icon, color }) => (
        <button
          key={label}
          type="button"
          onClick={() => {
            useComposerStore.getState().setDraft(text);
            useNavigationStore.getState().focusComposer();
          }}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-line bg-surface/70 px-2.5 text-[12px] text-ink-2 transition-colors hover:border-accent/30 hover:bg-accent-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
        >
          <Icon size={14} className={color} aria-hidden="true" />
          {label}
        </button>
      ))}
    </section>
  );
}
