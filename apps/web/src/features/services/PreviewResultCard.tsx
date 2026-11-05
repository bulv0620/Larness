import type { PreviewResultTarget } from "@larness/shared";
import { useWindowStore } from "@/stores/windowStore";

export function PreviewResultCard({ target }: { target: PreviewResultTarget }) {
  const open = useWindowStore((state) => state.open);
  return (
    <div className="py-1 text-[12px] text-ink-2">
      <button
        type="button"
        className="break-all text-left text-accent underline decoration-accent/30 underline-offset-4 hover:decoration-accent"
        onClick={() =>
          open({
            kind: "browser",
            resourceId: `browser:${target.serviceId}:${target.path}`,
            browser: { serviceId: target.serviceId, path: target.path },
            title: "预览服务",
            projectId: target.projectId,
            source: "agent",
          })
        }
      >
        打开预览 · {target.name ?? target.path}
      </button>
    </div>
  );
}
