// D-52: what the driver is told when a seat on their trip changes hands. Pure, so the two routes
// that fire it (join and leave) can't drift into saying different things about the same event, and
// so the wording is testable without a database.

export type SeatChange = "join" | "leave";

export interface SeatNotice {
  type: SeatChange;
  title: string;
  body: string;
}

// House voice, matching the notifications already in the bell: a short title naming what happened,
// then one sentence of body. A leave says the seat is free again because that is the part the
// driver can act on — it's an opening to offer someone else, not just a loss.
export function seatChangeNotice(change: SeatChange, riderName: string): SeatNotice {
  // A missing display_name must never render as "undefined grabbed a seat". The feed already falls
  // back to a nameless phrasing for a driver it can't resolve; this is the same idea for a rider.
  const who = riderName.trim() || "Someone";
  return change === "join"
    ? {
        type: "join",
        title: "Someone joined your ride",
        body: `${who} grabbed a seat on your trip.`,
      }
    : {
        type: "leave",
        title: "A rider dropped out",
        body: `${who} left your trip — their seat is free again.`,
      };
}
