"use client";

import { useState } from "react";
import { readJsonBody, UNREADABLE_REPLY } from "@/lib/http/readJsonBody";

// D-63. The ride counted itself at its departure time, but the driver couldn't leave then. They
// move it to later TODAY; the riders keep their seats, are told the new time, and may leave for
// free. The server does the rollback and has the final word on every rule — this sheet only asks
// for the time. No point figures on screen (developer, 2026-09-20: describe the act, not the maths).

interface Props {
  tripId: string;
  // The ride's current departure, as the card shows it ("7:30").
  time: string;
  // A round trip's return, which stays where it is. Null for a one-way ride.
  returnTime: string | null;
  riderCount: number;
  onClose: () => void;
  onDone: (message: string) => void;
}

// The next quarter hour at least 15 minutes out: a sensible first guess that is always valid.
function suggestedTime(now: Date): string {
  const d = new Date(now.getTime() + 15 * 60_000);
  const minutes = Math.ceil(d.getMinutes() / 15) * 15;
  d.setMinutes(minutes, 0, 0);
  // Rolling past midnight would suggest a time the server refuses; the input then starts empty.
  if (d.getDate() !== now.getDate()) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function todayAt(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const d = new Date();
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d.toISOString();
}

export function PostponeSheet({ tripId, time, returnTime, riderCount, onClose, onDone }: Props) {
  const [newTime, setNewTime] = useState(() => suggestedTime(new Date()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!newTime) {
      setError("Pick a time later today.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/trips/${tripId}/postpone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ departAt: todayAt(newTime) }),
      });
      const body = await readJsonBody<{ notifiedRiders?: number }>(res);
      if (!res.ok) {
        setError(body?.message ?? "Couldn't postpone this ride.");
        return;
      }
      if (!body) {
        setError(UNREADABLE_REPLY);
        return;
      }
      const notified = body.notifiedRiders ?? 0;
      onDone(
        notified > 0
          ? `Ride moved — ${notified} rider${notified === 1 ? "" : "s"} told the new time`
          : "Ride moved to later today",
      );
    } catch {
      setError("Couldn't reach the server — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheetc" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ font: "800 17px var(--font-display)", color: "var(--ink)", margin: "0 0 2px" }}>
          Couldn&apos;t leave at {time}?
        </h3>
        <p style={{ font: "500 11.5px/1.5 var(--font-body)", color: "rgba(0,0,0,.5)", margin: "0 0 14px" }}>
          Move this ride to later today. It goes back to the feed as a ride still ahead, and it counts again when
          it leaves at the new time.
          {riderCount > 0 &&
            ` ${riderCount === 1 ? "Your rider keeps their seat" : `Your ${riderCount} riders keep their seats`}, gets told the new time, and can leave for free if it no longer works.`}
        </p>

        <label className="lbl">New time today</label>
        <input
          className="field"
          type="time"
          value={newTime}
          onChange={(e) => setNewTime(e.target.value)}
          style={{ marginBottom: 12 }}
        />

        {returnTime && (
          <p style={{ font: "500 11px var(--font-body)", color: "rgba(0,0,0,.45)", margin: "0 2px 12px" }}>
            The return at {returnTime} stays as it is. You can edit it on its own card.
          </p>
        )}

        {error && <p style={{ color: "var(--danger)", font: "600 12px var(--font-body)", margin: "0 0 12px" }}>{error}</p>}
        <button className="btnP" disabled={busy} onClick={save}>
          Postpone ride
        </button>
        <button className="btnG" style={{ marginTop: 10 }} onClick={onClose} disabled={busy}>
          Never mind
        </button>
      </div>
    </div>
  );
}
