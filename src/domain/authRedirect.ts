import { isValidGroupCodeFormat, normalizeGroupCode } from "./groupCode";

// Where a visitor lands after clicking the confirmation link in their signup email.
//
// Pure on purpose: the only thing standing between an attacker-supplied `?next=` and an open
// redirect out of the app is `safeNextPath`, so it is unit-tested rather than trusted.

const DEFAULT_NEXT = "/app";

export function safeNextPath(next: string | null | undefined, fallback: string = DEFAULT_NEXT): string {
  if (typeof next !== "string") return fallback;
  const trimmed = next.trim();
  if (!trimmed.startsWith("/")) return fallback; // absolute URLs, mailto:, javascript:
  if (trimmed.startsWith("//")) return fallback; // protocol-relative — resolves to another origin
  if (trimmed.startsWith("/\\")) return fallback; // backslash variant some URL parsers accept
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return fallback; // control chars / header smuggling
  return trimmed;
}

// The invite path for a group code, or null if it isn't a code at all.
export function groupInvitePath(code: string | null | undefined): string | null {
  if (typeof code !== "string") return null;
  const normalized = normalizeGroupCode(code);
  return isValidGroupCodeFormat(normalized) ? `/j/${normalized}` : null;
}

// Which origin the confirmation link should come back to.
//
// Not simply NEXT_PUBLIC_APP_URL: that is the production URL, so local dev would mail a link that
// lands on the deployed site, and a Vercel preview would do the same. The request's own origin is
// the right answer — but it comes from a header, so it is allow-listed rather than trusted: the
// configured origin itself, localhost, or a *.vercel.app preview. Anything else falls back.
export function appOriginFor({
  requestUrl,
  forwardedHost,
  forwardedProto,
  configuredOrigin,
}: {
  requestUrl: string;
  forwardedHost?: string | null;
  forwardedProto?: string | null;
  configuredOrigin: string;
}): string {
  const configured = configuredOrigin.replace(/\/+$/, "");

  let candidate: URL;
  try {
    candidate = forwardedHost
      ? new URL(`${forwardedProto || "https"}://${forwardedHost}`)
      : new URL(new URL(requestUrl).origin);
  } catch {
    return configured;
  }

  let configuredHost = "";
  try {
    configuredHost = new URL(configured).host;
  } catch {
    configuredHost = "";
  }

  const host = candidate.hostname;
  const trusted =
    candidate.host === configuredHost ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.endsWith(".vercel.app");

  return trusted ? candidate.origin : configured;
}

// The `emailRedirectTo` handed to Supabase at signup: our own callback, carrying the destination
// the visitor was heading for before the confirmation email interrupted them.
export function emailConfirmRedirectUrl(appOrigin: string, next?: string | null): string {
  const origin = appOrigin.replace(/\/+$/, "");
  return `${origin}/auth/callback?next=${encodeURIComponent(safeNextPath(next))}`;
}
