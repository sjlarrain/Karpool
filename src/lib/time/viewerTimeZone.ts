import { cookies, headers } from "next/headers";
import { FALLBACK_TIME_ZONE, TIME_ZONE_COOKIE, isValidTimeZone } from "@/domain/timeZone";

// Server-side half of the display-zone plumbing (the pure half is src/domain/timeZone.ts). Every
// server render that turns a trip instant into a time string asks this which zone the reader is in.
//
// Order matters:
//  1. the cookie TimeZoneSync writes — the browser's own IANA zone, the only authoritative answer;
//  2. Vercel's geolocation header, so the very first request (before any cookie exists) is already
//     right for almost everyone instead of showing UTC for one render;
//  3. UTC, stated rather than guessed.
export async function viewerTimeZone(): Promise<string> {
  const fromCookie = (await cookies()).get(TIME_ZONE_COOKIE)?.value;
  if (fromCookie && isValidTimeZone(fromCookie)) return fromCookie;

  const fromEdge = (await headers()).get("x-vercel-ip-timezone");
  if (fromEdge && isValidTimeZone(fromEdge)) return fromEdge;

  return FALLBACK_TIME_ZONE;
}
