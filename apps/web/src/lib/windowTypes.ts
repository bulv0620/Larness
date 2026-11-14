import type { FileScope } from "@larness/shared";
export type WindowKind = "files" | "terminal" | "services" | "browser" | "git-diff";

export type TabOrigin = "global" | "project" | "session" | "agent" | "artifact";

export type ProjectFilter =
  | { mode: "all" }
  | { mode: "global" }
  | { mode: "project"; projectId: string };

export interface WindowTab {
  id: string;
  kind: WindowKind;
  resourceId: string;
  viewKey?: string;
  createdAt?: number;
  title: string;
  projectId: string | null;
  sourceSessionId: string | null;
  originType: TabOrigin;
  preview?: boolean;
  file?: { scope: FileScope; path: string };
  git?: { path: string; staged: boolean };
  browser?: { serviceId: string; path: string };
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
  activeTabId: string | null;
  filter: ProjectFilter;
  z: number;
  minimized: boolean;
  maximized: boolean;
  pinned: boolean;
  restore: Rect | null;
}
