import { describe, expect, it } from "vitest";
import { sanitizeRepositoryDisplay } from "./displaySanitization";

describe("hostile repository display metadata", () => {
  it("makes terminal escapes, bidi overrides and invisible separators visible", () => {
    const value = sanitizeRepositoryDisplay("A\u001b[31m\u202eB\u200b\u2215C\u0000");
    expect(value).toContain("\\u{001B}[31m");
    expect(value).toContain("\\u{202E}");
    expect(value).toContain("\\u{200B}\\u{2215}");
    expect(value).toContain("\\u{0000}");
    expect(value).not.toContain("\u001b");
  });
  it("caps display length with explicit truncation", () => {
    expect(sanitizeRepositoryDisplay("x".repeat(300), 8)).toBe("xxxxxxxx…");
  });
  it("leaves ordinary punctuation as literal text, not HTML", () => {
    expect(sanitizeRepositoryDisplay("<img src=x onerror=alert(1)>")).toBe("<img src=x onerror=alert(1)>");
  });
});
