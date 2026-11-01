import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  platform: "node",
  clean: true,
  dts: false,
  outExtensions: () => ({ js: ".js" }),
  deps: {
    alwaysBundle: ["@larness/shared"],
  },
});
