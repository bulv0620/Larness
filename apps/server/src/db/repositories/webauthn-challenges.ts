import { and, eq, isNull } from "drizzle-orm";
import type { DbExecutor } from "../client.js";
import { newId } from "../ids.js";
import { type ChallengeType, type WebAuthnChallengeRow, webauthnChallenges } from "../schema.js";

export interface CreateChallengeInput {
  type: ChallengeType;
  challenge: string;
  createdAt: number;
  expiresAt: number;
  requestId?: string;
  deviceId?: string;
}

export function createChallenge(db: DbExecutor, input: CreateChallengeInput): WebAuthnChallengeRow {
  const row: WebAuthnChallengeRow = {
    id: newId("chl"),
    type: input.type,
    challenge: input.challenge,
    requestId: input.requestId ?? null,
    deviceId: input.deviceId ?? null,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
    consumedAt: null,
  };

  db.insert(webauthnChallenges).values(row).run();

  return row;
}

export function getChallenge(db: DbExecutor, id: string): WebAuthnChallengeRow | null {
  return db.select().from(webauthnChallenges).where(eq(webauthnChallenges.id, id)).get() ?? null;
}

export function consumeChallenge(db: DbExecutor, id: string, now = Date.now()): boolean {
  return (
    db
      .update(webauthnChallenges)
      .set({ consumedAt: now })
      .where(and(eq(webauthnChallenges.id, id), isNull(webauthnChallenges.consumedAt)))
      .run().changes > 0
  );
}
