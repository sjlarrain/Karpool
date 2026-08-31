// Reading an API reply in the browser without mistaking a server fault for a lost connection.
//
// Every client handler in this app is written as fetch -> res.json() -> check res.ok, wrapped in a
// try/catch whose message is "Couldn't reach the server — check your connection and try again."
// That shape has a hole in it: an unhandled server fault does not answer with JSON, it answers with
// an HTML error page. `res.json()` throws on that, so control jumps past the `!res.ok` branch and
// into the catch — and the user is told to check their signal about a request that reached the
// server perfectly well and came back 500.
//
// It is not a cosmetic mistake. It is what made the close-trip failure (D-39) look like flaky phone
// signal for as long as it did, while every retry was duplicating points ledger rows. A handler
// that cannot tell "the request never left" from "the server broke" cannot report either honestly.
//
// So: parsing never throws. A reply that is not JSON comes back as null, `!res.ok` is reached and
// reported as the server problem it is, and the catch below it goes back to meaning only what it
// says — the request did not get out.

interface ApiErrorBody {
  /** Machine-readable code from the route, e.g. "full", "wrong_status". */
  error?: string;
  /** Human-readable text from the route, shown in preference to any local fallback. */
  message?: string;
}

/**
 * Reads a JSON reply, or null if the body is not JSON (an HTML error page, an empty body, a
 * response mangled in transit).
 *
 * `T` describes the fields the success path reads; the error fields are always present, so a
 * handler that only needs `message` can call this with no type argument at all.
 */
export async function readJsonBody<T = unknown>(res: Response): Promise<(T & ApiErrorBody) | null> {
  try {
    return (await res.json()) as T & ApiErrorBody;
  } catch {
    return null;
  }
}

/**
 * What to say when the request succeeded but its reply could not be read.
 *
 * Deliberately does not promise that nothing was saved. A 2xx means the write happened; an
 * unreadable 5xx means nobody knows. Telling someone "nothing was saved" and being wrong is how a
 * retry turns one action into two — which, for anything that writes points, is the expensive kind
 * of wrong.
 */
export const UNREADABLE_REPLY =
  "The server's reply couldn't be read. Your change may have gone through — refresh before trying again.";
