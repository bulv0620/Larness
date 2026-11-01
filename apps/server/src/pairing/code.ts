import { randomInt } from "node:crypto";

export const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const PAIRING_CODE_LENGTH = 10;
export const PAIRING_CODE_TTL_MS = 5 * 60_000;
export const PAIRING_CODE_MAX_ATTEMPTS = 5;
export const PAIRING_REQUEST_TTL_MS = 10 * 60_000;
export const ENROLLMENT_TTL_MS = 5 * 60_000;

export function generatePairingCode(): string {
  const characters: string[] = [];
  const limit = 256 - (256 % CROCKFORD_ALPHABET.length);

  while (characters.length < PAIRING_CODE_LENGTH) {
    const byte = randomInt(0, 256);

    if (byte < limit) {
      characters.push(CROCKFORD_ALPHABET[byte % CROCKFORD_ALPHABET.length] ?? "0");
    }
  }

  return characters.join("");
}

export function formatPairingCode(code: string): string {
  const normalized = normalizePairingCode(code);
  return `${normalized.slice(0, 5)}-${normalized.slice(5)}`;
}

export function normalizePairingCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
}

export function isValidPairingCode(input: string): boolean {
  const code = normalizePairingCode(input);

  if (code.length !== PAIRING_CODE_LENGTH) {
    return false;
  }

  return [...code].every((character) => CROCKFORD_ALPHABET.includes(character));
}

export function generateShortCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}
