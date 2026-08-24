import { describe, expect, it } from "vitest";
import { appOriginFor, emailConfirmRedirectUrl, groupInvitePath, safeNextPath } from "./authRedirect";

describe("safeNextPath", () => {
  it("keeps an in-app path, query and hash included", () => {
    expect(safeNextPath("/j/ABC123")).toBe("/j/ABC123");
    expect(safeNextPath("/app?g=1&trip=2")).toBe("/app?g=1&trip=2");
  });

  it("falls back when there is nothing to go on", () => {
    expect(safeNextPath(null)).toBe("/app");
    expect(safeNextPath(undefined)).toBe("/app");
    expect(safeNextPath("")).toBe("/app");
  });

  it("refuses anything that could leave the app", () => {
    expect(safeNextPath("https://evil.example/steal")).toBe("/app");
    expect(safeNextPath("//evil.example/steal")).toBe("/app");
    expect(safeNextPath("/\\evil.example")).toBe("/app");
    expect(safeNextPath("javascript:alert(1)")).toBe("/app");
    expect(safeNextPath("mailto:someone@example.com")).toBe("/app");
  });

  it("refuses control characters", () => {
    expect(safeNextPath("/app\nLocation: https://evil.example")).toBe("/app");
  });

  it("honours an explicit fallback", () => {
    expect(safeNextPath("https://evil.example", "/")).toBe("/");
  });
});

describe("groupInvitePath", () => {
  it("normalises a valid code", () => {
    expect(groupInvitePath("abc123")).toBe("/j/ABC123");
    expect(groupInvitePath("  ABC123  ")).toBe("/j/ABC123");
  });

  it("returns null for anything that isn't a code", () => {
    expect(groupInvitePath("ABC12")).toBeNull();
    expect(groupInvitePath("ABC-123")).toBeNull();
    expect(groupInvitePath("")).toBeNull();
    expect(groupInvitePath(null)).toBeNull();
  });
});

describe("appOriginFor", () => {
  const configuredOrigin = "https://karpool.vercel.app";

  it("uses the local dev origin instead of the production one", () => {
    expect(appOriginFor({ requestUrl: "http://localhost:3000/auth/callback?next=%2Fapp", configuredOrigin })).toBe(
      "http://localhost:3000",
    );
  });

  it("honours the proxy headers on the configured host", () => {
    expect(
      appOriginFor({
        requestUrl: "http://10.0.0.7/auth/callback",
        forwardedHost: "karpool.vercel.app",
        forwardedProto: "https",
        configuredOrigin,
      }),
    ).toBe("https://karpool.vercel.app");
  });

  it("allows a preview deployment", () => {
    expect(
      appOriginFor({
        requestUrl: "http://10.0.0.7/auth/callback",
        forwardedHost: "karpool-git-branch-team.vercel.app",
        configuredOrigin,
      }),
    ).toBe("https://karpool-git-branch-team.vercel.app");
  });

  it("falls back to the configured origin for a spoofed host", () => {
    expect(
      appOriginFor({
        requestUrl: "http://10.0.0.7/auth/callback",
        forwardedHost: "evil.example",
        configuredOrigin,
      }),
    ).toBe(configuredOrigin);
  });

  it("falls back when the request URL is unusable", () => {
    expect(appOriginFor({ requestUrl: "not a url", configuredOrigin })).toBe(configuredOrigin);
  });

  it("strips a trailing slash from the configured origin", () => {
    expect(appOriginFor({ requestUrl: "not a url", configuredOrigin: "https://karpool.vercel.app/" })).toBe(
      configuredOrigin,
    );
  });
});

describe("emailConfirmRedirectUrl", () => {
  it("points at our callback with the destination encoded", () => {
    expect(emailConfirmRedirectUrl("https://carpool.app", "/j/ABC123")).toBe(
      "https://carpool.app/auth/callback?next=%2Fj%2FABC123",
    );
  });

  it("tolerates a trailing slash on the origin", () => {
    expect(emailConfirmRedirectUrl("https://carpool.app/", "/app")).toBe(
      "https://carpool.app/auth/callback?next=%2Fapp",
    );
  });

  it("defaults to /app and sanitises a hostile destination", () => {
    expect(emailConfirmRedirectUrl("https://carpool.app")).toBe("https://carpool.app/auth/callback?next=%2Fapp");
    expect(emailConfirmRedirectUrl("https://carpool.app", "https://evil.example")).toBe(
      "https://carpool.app/auth/callback?next=%2Fapp",
    );
  });
});
