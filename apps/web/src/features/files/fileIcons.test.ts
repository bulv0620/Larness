import { expect, it } from "vitest";
import { fileIcon } from "./fileIcons";

it.each([
  ["src/App.TS", "typescript.svg"],
  ["src/App.tsx", "react_ts.svg"],
  ["App.jsx", "react.svg"],
  ["main.js", "javascript.svg"],
  ["main.py", "python.svg"],
  ["types.d.ts", "typescript-def.svg"],
  ["src/component.test.ts", "test-ts.svg"],
  ["Dockerfile", "docker.svg"],
  ["package.json", "nodejs.svg"],
  ["tsconfig.json", "tsconfig.svg"],
  ["config.yaml", "yaml.svg"],
  [".gitignore", "git.svg"],
  ["README.md", "readme.svg"],
  ["photo.png", "image.svg"],
  ["report.pdf", "pdf.svg"],
  ["report.docx", "word.svg"],
  ["data.csv", "table.svg"],
  ["archive.zip", "zip.svg"],
  ["unknown.no-known-type", "file.svg"],
])("resolves %s to %s", (file, icon) => {
  expect(fileIcon(file, "dark")).toBe(icon);
});

it("resolves an upstream light-mode override", () => {
  expect(fileIcon("vercel.json", "light")).toBe("vercel_light.svg");
  expect(fileIcon("vercel.json", "dark")).toBe("vercel.svg");
});
