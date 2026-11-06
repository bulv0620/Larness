import { BrowserView } from "@/features/windows/BrowserView";
import { DiffView } from "@/features/windows/DiffView";
import { FileWindow } from "@/features/windows/FileWindow";
import { ServiceWindow } from "@/features/windows/ServiceWindow";
import { TerminalWindow } from "@/features/windows/TerminalWindow";
import type { WindowTab } from "@/lib/windowTypes";

export function WindowContent({ tab, visible }: { tab: WindowTab | undefined; visible: boolean }) {
  if (!tab) return null;
  switch (tab.kind) {
    case "files":
      return <FileWindow tab={tab} />;
    case "terminal":
      return <TerminalWindow tab={tab} visible={visible} />;
    case "services":
      return <ServiceWindow tab={tab} />;
    case "browser":
      return <BrowserView tab={tab} />;
    case "git-diff":
      return <DiffView tab={tab} />;
    default:
      return null;
  }
}
