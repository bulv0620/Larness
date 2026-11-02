import { DevWebStartSchema } from "../../server/src/dev-web/control.js";
import { startManagedVite } from "./vite-runtime.js";

let running: Awaited<ReturnType<typeof startManagedVite>> | null = null;
let closing = false;
let starting = false;
const stop = async () => {
  closing = true;
  // Notify the supervisor before close waits on its still-connected HTTP clients.
  if (process.connected) process.disconnect();
  await running?.server.close();
};
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
process.once("disconnect", () => void stop());
process.on("message", (message: unknown) => {
  if (starting || closing) return;
  const parsed = DevWebStartSchema.safeParse(message);
  if (!parsed.success) {
    process.exitCode = 1;
    void stop();
    return;
  }
  starting = true;
  void startManagedVite(parsed.data.origin, undefined, parsed.data.generation)
    .then(async (value) => {
      running = value;
      if (closing) {
        await value.server.close();
        return;
      }
      process.send?.({
        type: "dev-web.ready",
        generation: parsed.data.generation,
        host: "127.0.0.1",
        port: value.port,
      });
    })
    .catch((error: unknown) => {
      const code =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof error.code === "string" &&
        /^[A-Z_0-9]{1,64}$/.test(error.code)
          ? error.code
          : "DEV_WEB_UNAVAILABLE";
      console.error(`[larness] 开发前端启动失败 (${code})`);
      process.exitCode = 1;
      if (process.connected) process.disconnect();
      void stop();
    });
});
if (!process.send) {
  console.error("[larness] 开发前端必须由 TUI 管理");
  process.exitCode = 1;
}
