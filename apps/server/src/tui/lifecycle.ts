export type SessionAction = "done" | "restart";

export async function runManagedSessions<T extends { stop(): Promise<void> }>(options: {
  start(): Promise<T>;
  attach(runtime: NoInfer<T>): Promise<SessionAction>;
  onRuntime(runtime: NoInfer<T> | null): void;
}): Promise<void> {
  for (;;) {
    const runtime = await options.start();
    options.onRuntime(runtime);
    let action: SessionAction;
    try {
      action = await options.attach(runtime);
    } finally {
      try {
        await runtime.stop();
      } finally {
        options.onRuntime(null);
      }
    }
    if (action !== "restart") return;
  }
}
