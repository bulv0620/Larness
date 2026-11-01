import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    status: "src/cli/status.ts",
    doctor: "src/cli/doctor.ts",
    tui: "src/tui/main.ts",
  },
  format: "esm",
  platform: "node",
  clean: true,
  dts: false,
  outExtensions: () => ({ js: ".js" }),
  deps: {
    alwaysBundle: ["@larness/shared"],
  },
});
