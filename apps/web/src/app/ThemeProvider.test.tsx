import { describe, expect, it } from "vitest";
import { resolveTheme } from "./ThemeProvider";

describe("resolveTheme", () => {
  it("resolves explicit themes", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("follows the system preference", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});
