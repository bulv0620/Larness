import type { TurnRunResult } from "./turnRunner.js";

export interface QueuedTurnRunner {
  run(turnId: string): Promise<TurnRunResult>;
  cancel(turnId: string): boolean;
  stop(): void;
}

export interface TurnQueueOptions {
  runner: QueuedTurnRunner;
  maxConcurrent?: number;
  onError?: (error: unknown, turnId: string) => void;
  /** Called after a run settles; used for automatic continuation. */
  onSettled?: (turnId: string, sessionId: string, result: TurnRunResult) => void;
}

interface PendingTurn {
  turnId: string;
  sessionId: string;
}

export class TurnQueue {
  readonly #runner: QueuedTurnRunner;
  readonly #maxConcurrent: number;
  readonly #onError: ((error: unknown, turnId: string) => void) | undefined;
  readonly #onSettled:
    | ((turnId: string, sessionId: string, result: TurnRunResult) => void)
    | undefined;
  readonly #pending: PendingTurn[] = [];
  readonly #running = new Set<string>();
  readonly #runningSessions = new Set<string>();
  readonly #tasks = new Set<Promise<unknown>>();
  #active = 0;
  #stopped = false;

  constructor(options: TurnQueueOptions) {
    this.#runner = options.runner;
    this.#maxConcurrent = Math.max(Math.trunc(options.maxConcurrent ?? 2), 1);
    this.#onError = options.onError;
    this.#onSettled = options.onSettled;
  }

  enqueue(turnId: string, sessionId: string): void {
    if (this.#stopped || this.#running.has(turnId)) {
      return;
    }

    if (this.#pending.some((entry) => entry.turnId === turnId)) {
      return;
    }

    this.#pending.push({ turnId, sessionId });
    this.#pump();
  }

  cancel(turnId: string): boolean {
    return this.#runner.cancel(turnId);
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    this.#pending.length = 0;
    this.#runner.stop();
    await Promise.allSettled([...this.#tasks]);
  }

  activeCount(): number {
    return this.#active;
  }

  pendingCount(): number {
    return this.#pending.length;
  }

  #pump(): void {
    if (this.#stopped) {
      return;
    }

    while (this.#active < this.#maxConcurrent) {
      const index = this.#pending.findIndex((entry) => !this.#runningSessions.has(entry.sessionId));

      if (index === -1) {
        return;
      }

      const [entry] = this.#pending.splice(index, 1);

      if (entry === undefined) {
        return;
      }

      this.#active += 1;
      this.#running.add(entry.turnId);
      this.#runningSessions.add(entry.sessionId);

      const task = this.#runner
        .run(entry.turnId)
        .then((result) => {
          try {
            this.#onSettled?.(entry.turnId, entry.sessionId, result);
          } catch (error) {
            this.#onError?.(error, entry.turnId);
          }

          return result;
        })
        .catch((error: unknown) => {
          this.#onError?.(error, entry.turnId);
        })
        .finally(() => {
          this.#active -= 1;
          this.#running.delete(entry.turnId);
          this.#runningSessions.delete(entry.sessionId);
          this.#tasks.delete(task);
          this.#pump();
        });
      this.#tasks.add(task);
    }
  }
}
