import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export interface BenchmarkFile {
  path: string;
  content: string;
}

export interface BenchmarkTask {
  id: string;
  title: string;
  prompts: string[];
  files: BenchmarkFile[];
  verify: string[];
}

const AGENTS = [
  "# Benchmark fixture",
  "",
  "Run `node --test` after making changes.",
  "Keep the change minimal and do not rewrite unrelated files.",
].join("\n");

const PACKAGE = JSON.stringify({ type: "module", private: true }, null, 2);

function longConfig(): string {
  const lines = Array.from({ length: 600 }, (_, index) => `// configuration line ${index + 1}`);
  lines[299] = "export const DEFAULT_TIMEOUT = 60;";
  lines[300] = "export const RETRY_LIMIT = 2;";
  return `${lines.join("\n")}\n`;
}

function searchModules(): BenchmarkFile[] {
  return Array.from({ length: 80 }, (_, index) => {
    const id = String(index).padStart(2, "0");
    return {
      path: `src/modules/m${id}.js`,
      content: `export const candidate${id} = ${index};\n`,
    };
  });
}

export const TASKS: BenchmarkTask[] = [
  {
    id: "single-file-fix",
    title: "单文件修复",
    prompts: ["The test suite is failing. Find the cause, fix it, and run `node --test`."],
    files: [
      { path: "package.json", content: PACKAGE },
      { path: "AGENTS.md", content: AGENTS },
      { path: "src/math.js", content: "export function add(a, b) {\n  return a - b;\n}\n" },
      {
        path: "test/math.test.js",
        content: [
          'import test from "node:test";',
          'import assert from "node:assert/strict";',
          'import { add } from "../src/math.js";',
          "",
          'test("adds two numbers", () => {',
          "  assert.equal(add(2, 3), 5);",
          "});",
          "",
        ].join("\n"),
      },
    ],
    verify: ["node", "--test"],
  },
  {
    id: "cross-file-refactor",
    title: "跨文件重构",
    prompts: ["Rename `computeTotal` to `sumTotal` across the project and keep the tests passing."],
    files: [
      { path: "package.json", content: PACKAGE },
      { path: "AGENTS.md", content: AGENTS },
      {
        path: "src/total.js",
        content:
          "export function computeTotal(items) {\n  return items.reduce((sum, item) => sum + item, 0);\n}\n",
      },
      {
        path: "src/use.js",
        content:
          'import { computeTotal } from "./total.js";\n\nexport const total = computeTotal([1, 2]);\n',
      },
      {
        path: "test/use.test.js",
        content: [
          'import test from "node:test";',
          'import assert from "node:assert/strict";',
          'import { total } from "../src/use.js";',
          "",
          'test("sums values", () => {',
          "  assert.equal(total, 3);",
          "});",
          "",
        ].join("\n"),
      },
      {
        path: "scripts/verify.js",
        content: [
          'import { readFileSync } from "node:fs";',
          'import { spawnSync } from "node:child_process";',
          "",
          'const total = readFileSync("src/total.js", "utf8");',
          'const use = readFileSync("src/use.js", "utf8");',
          'if (!total.includes("sumTotal") || !use.includes("sumTotal")) process.exit(1);',
          'if (total.includes("computeTotal") || use.includes("computeTotal")) process.exit(1);',
          'const result = spawnSync(process.execPath, ["--test"], { stdio: "inherit" });',
          "process.exit(result.status ?? 1);",
          "",
        ].join("\n"),
      },
    ],
    verify: ["node", "scripts/verify.js"],
  },
  {
    id: "long-file-edit",
    title: "长文件编辑",
    prompts: ["Change `DEFAULT_TIMEOUT` to 30 seconds and run the tests."],
    files: [
      { path: "package.json", content: PACKAGE },
      { path: "AGENTS.md", content: AGENTS },
      { path: "src/config.js", content: longConfig() },
      {
        path: "test/config.test.js",
        content: [
          'import test from "node:test";',
          'import assert from "node:assert/strict";',
          'import { DEFAULT_TIMEOUT } from "../src/config.js";',
          "",
          'test("default timeout", () => {',
          "  assert.equal(DEFAULT_TIMEOUT, 30);",
          "});",
          "",
        ].join("\n"),
      },
    ],
    verify: ["node", "--test"],
  },
  {
    id: "multi-turn-fix",
    title: "多轮连续修复",
    prompts: [
      "Fix the failing test in test/a.test.js and run the suite.",
      "Continue: fix the remaining failing test without breaking the first one.",
    ],
    files: [
      { path: "package.json", content: PACKAGE },
      { path: "AGENTS.md", content: AGENTS },
      { path: "src/a.js", content: "export const a = 1;\n" },
      { path: "src/b.js", content: "export const b = 1;\n" },
      {
        path: "test/a.test.js",
        content: [
          'import test from "node:test";',
          'import assert from "node:assert/strict";',
          'import { a } from "../src/a.js";',
          "",
          'test("a", () => {',
          "  assert.equal(a, 2);",
          "});",
          "",
        ].join("\n"),
      },
      {
        path: "test/b.test.js",
        content: [
          'import test from "node:test";',
          'import assert from "node:assert/strict";',
          'import { b } from "../src/b.js";',
          "",
          'test("b", () => {',
          "  assert.equal(b, 3);",
          "});",
          "",
        ].join("\n"),
      },
    ],
    verify: ["node", "--test"],
  },
  {
    id: "search-symbol",
    title: "大仓库符号定位",
    prompts: [
      "The test expects `legacyFlag` to be true. Find where it is defined and enable it, then run `node --test`.",
    ],
    files: [
      { path: "package.json", content: PACKAGE },
      { path: "AGENTS.md", content: AGENTS },
      ...searchModules(),
      {
        path: "src/modules/target.js",
        content: "export const legacyFlag = false;\n",
      },
      {
        path: "test/target.test.js",
        content: [
          'import test from "node:test";',
          'import assert from "node:assert/strict";',
          'import { legacyFlag } from "../src/modules/target.js";',
          "",
          'test("legacy flag", () => {',
          "  assert.equal(legacyFlag, true);",
          "});",
          "",
        ].join("\n"),
      },
    ],
    verify: ["node", "--test"],
  },
];

export function taskById(id: string): BenchmarkTask | undefined {
  return TASKS.find((task) => task.id === id);
}

export async function seedTask(task: BenchmarkTask, root: string): Promise<void> {
  for (const file of task.files) {
    const target = path.join(root, file.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.content, "utf8");
  }
}
