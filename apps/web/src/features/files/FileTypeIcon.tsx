import type { CSSProperties } from "react";
import { fileIcon } from "./fileIcons";

const icons = import.meta.glob<string>(
  [
    "/node_modules/material-icon-theme/icons/*.svg",
    "!/node_modules/material-icon-theme/icons/folder*.svg",
  ],
  {
    eager: true,
    import: "default",
    query: "?url&no-inline",
  },
);

function iconUrl(icon: string) {
  const root = "/node_modules/material-icon-theme/icons";
  return icons[`${root}/${icon}`] ?? icons[`${root}/file.svg`];
}

export function FileTypeIcon({ path, size = 16 }: { path: string; size?: number }) {
  const light = iconUrl(fileIcon(path, "light"));
  const dark = iconUrl(fileIcon(path, "dark"));
  const style = {
    width: size,
    height: size,
    "--file-icon": `url("${light}")`,
    "--file-icon-dark": `url("${dark}")`,
  } as CSSProperties;
  return (
    <span
      aria-hidden="true"
      className="inline-block shrink-0 bg-contain bg-center bg-no-repeat [background-image:var(--file-icon)] [[data-theme=dark]_&]:[background-image:var(--file-icon-dark)]"
      style={style}
    />
  );
}
