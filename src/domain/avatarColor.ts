// Deterministic color assignment for entities without a stored avatar_color (e.g. guest riders,
// group avatars) — pure hash over an id/name, no I/O.

const AVATAR_COLORS = [
  "var(--purple)",
  "var(--teal)",
  "var(--cyan)",
  "var(--amber)",
  "var(--pink)",
  "var(--coral)",
  "var(--green)",
];

export function avatarColorFor(seed: string): string {
  let sum = 0;
  for (let i = 0; i < seed.length; i++) sum += seed.charCodeAt(i);
  return AVATAR_COLORS[sum % AVATAR_COLORS.length]!;
}
