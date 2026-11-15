import { Bug, Code2, FolderSearch } from "lucide-react";
import { useComposerStore } from "@/stores/composerStore";
import { useNavigationStore } from "@/stores/navigationStore";
import "./welcome-backdrop.css";

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

export function WelcomeBackdrop() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 grid place-items-center [container-type:size]"
    >
      <div
        data-testid="welcome-backdrop"
        className="welcome-backdrop relative aspect-square w-[min(100cqw,100cqh,620px)]"
      />
    </div>
  );
}

export function WelcomeHeading() {
  return (
    <h2 className="mb-5 text-center text-[23px] font-semibold tracking-tight text-ink sm:text-[27px]">
      今天想做什么？
    </h2>
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
