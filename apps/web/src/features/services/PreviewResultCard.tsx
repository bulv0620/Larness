import type { PreviewResultTarget } from "@larness/shared";
import { Globe2 } from "lucide-react";
import { ResultCard } from "@/features/chat/ResultCard";
import { useWindowStore } from "@/stores/windowStore";

export function PreviewResultCard({ target }: { target: PreviewResultTarget }) {
  const open = useWindowStore((state) => state.open);
  const label = target.name ?? target.path;
  return (
    <ResultCard
      icon={Globe2}
      label={`预览 · ${label}`}
      ariaLabel={`打开预览 · ${label}`}
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
    />
  );
}
