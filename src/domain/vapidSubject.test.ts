import { describe, expect, it } from "vitest";
import { normalizeVapidSubject } from "./vapidSubject";

describe("normalizeVapidSubject", () => {
  it("leaves a valid mailto: subject exactly as it is", () => {
    expect(normalizeVapidSubject("mailto:someone@example.com")).toEqual({
      subject: "mailto:someone@example.com",
      normalizedFrom: null,
    });
  });

  it("leaves a valid https: subject exactly as it is", () => {
    expect(normalizeVapidSubject("https://example.com/contact")).toEqual({
      subject: "https://example.com/contact",
      normalizedFrom: null,
    });
  });

  it("completes the production value that actually broke push", () => {
    // GET /api/admin/health, 2026-08-31: "Vapid subject is not a valid URL.
    // karpool-nu.vercel.app/contact"
    expect(normalizeVapidSubject("karpool-nu.vercel.app/contact")).toEqual({
      subject: "https://karpool-nu.vercel.app/contact",
      normalizedFrom: "karpool-nu.vercel.app/contact",
    });
  });

  it("completes a bare host with no path", () => {
    expect(normalizeVapidSubject("karpool-nu.vercel.app").subject).toBe("https://karpool-nu.vercel.app");
  });

  it("completes a bare email address to mailto:", () => {
    expect(normalizeVapidSubject("someone@example.com")).toEqual({
      subject: "mailto:someone@example.com",
      normalizedFrom: "someone@example.com",
    });
  });

  it("trims surrounding whitespace, which a copy-paste into a dashboard field easily carries", () => {
    expect(normalizeVapidSubject("  mailto:someone@example.com  ").subject).toBe("mailto:someone@example.com");
  });

  it("never rewrites a scheme that is already present, even a wrong one", () => {
    // http: is not acceptable to web-push, but choosing https on someone's behalf is a guess about
    // their infrastructure rather than a missing prefix. It is passed through to be reported.
    expect(normalizeVapidSubject("http://example.com")).toEqual({
      subject: "http://example.com",
      normalizedFrom: null,
    });
    expect(normalizeVapidSubject("ftp://example.com").normalizedFrom).toBeNull();
  });

  it("does not treat a path containing @ as an address", () => {
    expect(normalizeVapidSubject("example.com/a@b").subject).toBe("https://example.com/a@b");
  });

  it("leaves something that is recognisably neither alone, so the error names the real value", () => {
    expect(normalizeVapidSubject("not a subject at all")).toEqual({
      subject: "not a subject at all",
      normalizedFrom: null,
    });
    expect(normalizeVapidSubject("localhost").normalizedFrom).toBeNull();
  });

  it("passes an empty value straight through rather than inventing one", () => {
    expect(normalizeVapidSubject("")).toEqual({ subject: "", normalizedFrom: null });
    expect(normalizeVapidSubject("   ").subject).toBe("");
  });
});
