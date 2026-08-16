import { describe, expect, it } from "vitest";
import { generateGroupCode, isValidGroupCodeFormat, normalizeGroupCode } from "./groupCode";

describe("generateGroupCode", () => {
  it("generates a 6-char code using only the unambiguous alphabet", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateGroupCode();
      expect(code).toHaveLength(6);
      expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    }
  });
});

describe("normalizeGroupCode", () => {
  it("trims and upper-cases", () => {
    expect(normalizeGroupCode("  north1 ")).toBe("NORTH1");
  });
});

describe("isValidGroupCodeFormat", () => {
  it("accepts a 6-char uppercase alphanumeric code", () => {
    expect(isValidGroupCodeFormat("NORTH1")).toBe(true);
  });

  it("rejects wrong length", () => {
    expect(isValidGroupCodeFormat("NORTH12")).toBe(false);
    expect(isValidGroupCodeFormat("NORT")).toBe(false);
  });

  it("rejects lowercase", () => {
    expect(isValidGroupCodeFormat("north1")).toBe(false);
  });

  it("rejects non-alphanumeric characters", () => {
    expect(isValidGroupCodeFormat("NORTH!")).toBe(false);
  });
});
