import {
  file,
  fileExtensions,
  fileNames,
  iconDefinitions,
  light,
} from "material-icon-theme/dist/material-icons.json";

function lookup(map: Readonly<Record<string, string>>, key: string): string | undefined {
  return Object.hasOwn(map, key) ? map[key] : undefined;
}

export function fileIcon(path: string, theme: "light" | "dark"): string {
  const parts = path.replaceAll("\\", "/").toLowerCase().split("/");
  const basename = parts.at(-1) ?? "";
  const names = theme === "light" ? light.fileNames : {};
  const extensions = theme === "light" ? light.fileExtensions : {};
  let id: string | undefined;
  for (let index = 0; index < parts.length && !id; index++) {
    const name = parts.slice(index).join("/");
    id = lookup(names, name) ?? lookup(fileNames, name);
  }
  for (let dot = basename.indexOf("."); dot !== -1 && !id; dot = basename.indexOf(".", dot + 1)) {
    const extension = basename.slice(dot + 1);
    id = lookup(extensions, extension) ?? lookup(fileExtensions, extension);
  }
  const definitions: Readonly<Record<string, { iconPath: string }>> = iconDefinitions;
  return definitions[id ?? file]?.iconPath.split("/").at(-1) ?? "file.svg";
}
