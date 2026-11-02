import { DevWebStartSchema } from "../../server/src/dev-web/control.js";
import { startManagedVite } from "./vite-runtime.js";

let running: Awaited<ReturnType<typeof startManagedVite>> | null = null;
let closing = false;
let starting = false;
const stop = async () => {
  closing = true;
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
  void startManagedVite(parsed.data.origin)
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
    .catch(() => {
      console.error("[larness] 开发前端启动失败");
      process.exitCode = 1;
      process.disconnect?.();
      void stop();
    });
});
if (!process.send) {
  console.error("[larness] 开发前端必须由 TUI 管理");
  process.exitCode = 1;
}
