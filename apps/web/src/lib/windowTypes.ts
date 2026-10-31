export type WindowKind = "files" | "terminal" | "services" | "browser" | "git-diff";

export interface WindowTab {
  id: string;
  kind: WindowKind;
  resourceId: string;
  title: string;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ManagedWindow extends Rect {
  id: string;
  tabs: WindowTab[];
  activeTabId: string;
  z: number;
  minimized: boolean;
  maximized: boolean;
  pinned: boolean;
  restore: Rect | null;
}
