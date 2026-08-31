// One place decides what "7:45" means. Trip instants are stored as timestamptz and are absolute;
// every human-facing time string is a *rendering* of one, and a rendering needs a zone. Before
// this existed the renderers used the runtime's local zone — which on Vercel is UTC — so a driver
// who published a 7:45 ride in California read it back as 14:45.
//
// The zone travels from the browser (the only place that knows it) to the server in a cookie; this
// module is the shared, pure half — safe to import from both a client component and a server one.

export const TIME_ZONE_COOKIE = "carpool_tz";

// Used only until the browser has told us better (a first-ever request, or a client with cookies
// off). Deliberately UTC rather than a guess at a "main" zone: wrong-but-stated beats wrong-and-
// invented, and it is corrected within one render.
export const FALLBACK_TIME_ZONE = "UTC";

// IANA names only — the value arrives from a cookie, so it is attacker-controlled input that ends
// up inside Intl. The shape check keeps out anything that isn't a zone name; the constructor call
// is the real test (it throws RangeError on a name ICU doesn't know).
const IANA_NAME = /^[A-Za-z0-9+_\-]+(?:\/[A-Za-z0-9+_\-]+){0,2}$/;

export function isValidTimeZone(value: string): boolean {
  if (!IANA_NAME.test(value) || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    // RangeError from ICU is the answer to the question, not an error to report.
    return false;
  }
}
