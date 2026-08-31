"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { TIME_ZONE_COOKIE, isValidTimeZone } from "@/domain/timeZone";

// The server renders every trip time, and only the browser knows which zone to render it in. This
// tells it, once, in a cookie every subsequent request carries — so the times are already correct
// in the server-rendered HTML instead of being corrected after hydration (which would be a visible
// flicker, and a hydration mismatch).
//
// It re-checks on every mount rather than only when the cookie is missing: people travel, and a
// laptop that changed zone should not keep reading yesterday's zone off a year-long cookie.
export function TimeZoneSync() {
  const router = useRouter();

  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!zone || !isValidTimeZone(zone)) return;

    const current = document.cookie
      .split("; ")
      .find((entry) => entry.startsWith(`${TIME_ZONE_COOKIE}=`))
      ?.slice(TIME_ZONE_COOKIE.length + 1);
    if (current === zone) return;

    // Lax: it is only ever read by this app's own document requests. A year, because the answer
    // changes about as often as someone moves.
    document.cookie = `${TIME_ZONE_COOKIE}=${zone}; path=/; max-age=31536000; samesite=lax`;
    // Re-runs the server components with the zone now known, replacing any UTC-rendered times.
    router.refresh();
  }, [router]);

  return null;
}
