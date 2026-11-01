import { describe, expect, it } from "vitest";
import {
  CROCKFORD_ALPHABET,
  formatPairingCode,
  generatePairingCode,
  generateShortCode,
  isValidPairingCode,
  normalizePairingCode,
} from "../../src/pairing/code.js";

describe("pairing codes", () => {
  it("generates 10-character Crockford Base32 codes", () => {
    const codes = new Set<string>();

    for (let index = 0; index < 200; index += 1) {
      const code = generatePairingCode();
      expect(code).toHaveLength(10);
      expect([...code].every((character) => CROCKFORD_ALPHABET.includes(character))).toBe(true);
      codes.add(code);
    }

    expect(codes.size).toBeGreaterThan(190);
  });

  it("formats and normalizes user input", () => {
    expect(formatPairingCode("abcde12345")).toBe("ABCDE-12345");
    expect(normalizePairingCode("abcde-12345")).toBe("ABCDE12345");
    expect(normalizePairingCode(" O0 I1 L1 ")).toBe("001111");
    expect(normalizePairingCode("ABCDE 12345")).toBe("ABCDE12345");
  });

  it("rejects invalid codes", () => {
    expect(isValidPairingCode("ABCDE12345")).toBe(true);
    expect(isValidPairingCode("ABCDE-12345")).toBe(true);
    expect(isValidPairingCode("ABCDE1234")).toBe(false);
    expect(isValidPairingCode("ABCDE1234U")).toBe(false);
  });

  it("generates six-digit short codes", () => {
    for (let index = 0; index < 50; index += 1) {
      expect(generateShortCode()).toMatch(/^\d{6}$/);
    }
  });
});
