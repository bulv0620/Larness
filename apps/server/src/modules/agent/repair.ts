import type { Database } from "../../db/client.js";
import type { TurnStatus } from "../../db/schema.js";
import { immediateTransaction } from "../../db/transaction.js";
import {
  getTurnById,
  isActiveTurnStatus,
  listActiveTurnRows,
  updateTurnRow,
} from "../sessions/repository.js";
import { appendAgentEvent } from "./events.js";

export interface RepairInterruptedTurnsOptions {
  db: Database;
  now?: () => number;
}

const INTERRUPTED_ERROR = {
  code: "INTERRUPTED",
  message: "turn was interrupted by a server restart",
} as const;

export function repairInterruptedTurns(options: RepairInterruptedTurnsOptions): number {
  const now = options.now?.() ?? Date.now();

  return immediateTransaction(options.db, (tx) => {
    let repaired = 0;

    for (const candidate of listActiveTurnRows(tx)) {
      const current = getTurnById(tx, candidate.id);

      if (current === null || !isActiveTurnStatus(current.status)) {
        continue;
      }

      const status: TurnStatus = "INTERRUPTED";
      updateTurnRow(tx, current.id, {
        status,
        endedAt: now,
        terminalReason: "interrupted",
        errorJson: JSON.stringify(INTERRUPTED_ERROR),
      });
      appendAgentEvent(tx, {
        sessionId: current.sessionId,
        turnId: current.id,
        type: "turn.interrupted",
        payload: { turnId: current.id, reason: INTERRUPTED_ERROR.message },
        now,
      });
      repaired += 1;
    }

    return repaired;
  });
}
