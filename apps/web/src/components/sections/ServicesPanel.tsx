import { IconButton } from "@harness/ui";
import { Play, RotateCw } from "lucide-react";
import { StatusDot } from "@/components/common/StatusDot";
import { useSnapshot } from "@/lib/queries";
import { useWindowStore } from "@/stores/windowStore";

export function ServicesPanel({ projectId }: { projectId: string | null }) {
  const { data } = useSnapshot();
  const open = useWindowStore((state) => state.open);
  const services = data.services.filter((service) => service.projectId === projectId);

  if (!services.length) {
    return <div className="px-2 py-3 text-[10.5px] text-ink-3">当前项目暂无服务</div>;
  }

  return (
    <div className="space-y-0.5 px-1.5">
      {services.map((service) => (
        <div
          key={service.id}
          className="group flex items-center gap-1 rounded-lg pr-1 transition-colors hover:bg-black/[.035] dark:hover:bg-white/[.05]"
        >
          <button
            type="button"
            onClick={() => open({ kind: "services", resourceId: service.id, title: service.name })}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <StatusDot
              tone={
                service.status === "running"
                  ? "running"
                  : service.status === "failed"
                    ? "error"
                    : "idle"
              }
              pulse={service.status === "running"}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11.5px] font-medium text-ink">
                {service.name}
              </span>
              <span className="block font-mono text-[10px] text-ink-3">
                :{service.port} · {service.runtime}
              </span>
            </span>
          </button>
          <IconButton
            label={`重启 ${service.name}`}
            className="h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
          >
            {service.status === "running" ? <RotateCw size={12} /> : <Play size={12} />}
          </IconButton>
        </div>
      ))}
    </div>
  );
}
