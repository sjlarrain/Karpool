// Making sense of whatever ended up in VAPID_SUBJECT.
//
// web-push demands a `mailto:` or `https:` URI and calls `new URL()` on the raw value, so a subject
// with no scheme at all — `karpool-nu.vercel.app/contact`, `someone@example.com` — is not a
// rejected URL, it is not a URL. The whole push channel then fails to configure, and every
// notification in the app is written to the bell and delivered to nobody.
//
// That has now cost this project twice: flagged as invalid on 2026-08-16, still invalid in
// production on 2026-08-31, where it took down the close-trip flow. Both times the value was
// *recognisably* what the developer meant and unusable only because of a missing prefix.
//
// So a scheme-less value is completed rather than refused. This is deliberately the narrowest kind
// of normalisation — it never changes a scheme that is already there, never rewrites the host, and
// never picks between http and https for someone. It only supplies a prefix that the shape of the
// value already determines. Anything genuinely ambiguous is passed through untouched so web-push
// reports it, and every normalisation is announced through GET /api/admin/health rather than
// applied silently, because config that quietly repairs itself is config nobody ever fixes.

export interface NormalizedVapidSubject {
  /** The value to hand to web-push. */
  subject: string;
  /** What the prefix was completed to, or null when the input was already usable as-is. */
  normalizedFrom: string | null;
}

// A bare address: exactly one @, something on each side, and no slash before it (which would make
// it a path, not an address).
function looksLikeBareEmail(value: string): boolean {
  const at = value.indexOf("@");
  if (at <= 0 || at !== value.lastIndexOf("@")) return false;
  if (value.slice(0, at).includes("/")) return false;
  return value.length > at + 1;
}

export function normalizeVapidSubject(raw: string): NormalizedVapidSubject {
  const value = raw.trim();
  if (value.length === 0) return { subject: value, normalizedFrom: null };

  // Already carries a scheme of any kind — including a wrong one. Passed through so web-push can
  // reject it on its own terms; guessing that `http:` meant `https:` is a judgement about someone's
  // infrastructure, not a missing prefix.
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return { subject: value, normalizedFrom: null };

  if (looksLikeBareEmail(value)) return { subject: `mailto:${value}`, normalizedFrom: value };

  // A host, or a host with a path. https rather than http because web-push accepts only https, so
  // the other choice would be completing the value into a different error.
  if (/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+([/?#]|$)/i.test(value)) {
    return { subject: `https://${value}`, normalizedFrom: value };
  }

  // Not recognisably either. Left alone so the error names the real value.
  return { subject: value, normalizedFrom: null };
}
