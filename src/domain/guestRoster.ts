// D-55: who a confirmed seat counts for, once guests can be linked to real accounts. Pure, no I/O,
// and shared by the two routes that build a `pooled` count so they cannot disagree about the same
// seat — the exact failure D-51 had to fix in the other direction.

export interface GuestClaim {
  id: string;
  // Null until a group admin links this guest to a member.
  claimedByProfileId: string | null;
}

export interface PooledSeat {
  profileId: string | null;
  groupGuestId: string | null;
}

// The merge, in one line: a seat belongs to its rider, or — if a guest held it — to whoever that
// guest has since been linked to. An unclaimed guest's seat belongs to nobody, which is exactly
// what it did before this feature existed, so nothing about the old behaviour changes until an
// admin acts. A guest typed free-hand at close (no group_guest_id) is never claimable and always
// counts for nobody: D-09's name-only guest, untouched.
export function seatOwner(seat: PooledSeat, claimantByGuestId: ReadonlyMap<string, string | null>): string | null {
  if (seat.profileId) return seat.profileId;
  if (!seat.groupGuestId) return null;
  return claimantByGuestId.get(seat.groupGuestId) ?? null;
}

// profileId -> rides taken. Both real seats and claimed guest seats land on the same key, which is
// why linking a guest makes their whole history appear at once rather than only counting forward.
export function tallyPooledRides(
  seats: readonly PooledSeat[],
  claimantByGuestId: ReadonlyMap<string, string | null>,
): Map<string, number> {
  const tally = new Map<string, number>();
  for (const seat of seats) {
    const owner = seatOwner(seat, claimantByGuestId);
    if (!owner) continue;
    tally.set(owner, (tally.get(owner) ?? 0) + 1);
  }
  return tally;
}

// groupGuestId -> rides taken, for the guests nobody has linked yet. These are the greyed "not
// registered" rows on Ranks: the count is real and accruing, it just has no account to sit on.
// A guest who HAS been claimed is deliberately absent — their rides are on their member's line now,
// and showing both would count the same ride twice on one screen.
export function tallyUnclaimedGuestRides(
  seats: readonly PooledSeat[],
  claimantByGuestId: ReadonlyMap<string, string | null>,
): Map<string, number> {
  const tally = new Map<string, number>();
  for (const seat of seats) {
    if (!seat.groupGuestId) continue;
    if (claimantByGuestId.get(seat.groupGuestId)) continue;
    tally.set(seat.groupGuestId, (tally.get(seat.groupGuestId) ?? 0) + 1);
  }
  return tally;
}

export function claimantByGuestId(guests: readonly GuestClaim[]): Map<string, string | null> {
  return new Map(guests.map((g) => [g.id, g.claimedByProfileId]));
}
