// Mirrors public.compute_initials() in supabase/migrations/0001_init.sql — used client/API-side for
// entities that don't have a stored `profile.initials` (guest riders have no profile row).

export function initialsFor(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
