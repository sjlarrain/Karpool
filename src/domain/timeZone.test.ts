import { describe, expect, it } from "vitest";
import { FALLBACK_TIME_ZONE, isValidTimeZone } from "./timeZone";

describe("isValidTimeZone", () => {
  it("accepts IANA zone names", () => {
    expect(isValidTimeZone("America/Los_Angeles")).toBe(true);
    expect(isValidTimeZone("Europe/Madrid")).toBe(true);
    expect(isValidTimeZone("America/Argentina/Buenos_Aires")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
  });

  it("rejects names ICU doesn't know", () => {
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });

  it("rejects anything that isn't shaped like a zone name", () => {
    // The value arrives from a cookie, so it is untrusted input on its way into Intl.
    expect(isValidTimeZone("../../etc/passwd")).toBe(false);
    expect(isValidTimeZone("UTC; drop table trip")).toBe(false);
    expect(isValidTimeZone("A".repeat(200))).toBe(false);
  });

  it("has a usable fallback", () => {
    expect(isValidTimeZone(FALLBACK_TIME_ZONE)).toBe(true);
  });
});
