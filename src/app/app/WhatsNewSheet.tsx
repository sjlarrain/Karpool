"use client";

import { useState } from "react";
import { ANNOUNCEMENT_KEY } from "@/domain/announcement";

// D-61 (developer, 2026-09-19: "a notification message for the users that get into the platform so
// they can check this new things. Sort of a pop up"). Shown once per person, on their next visit.
//
// "Once" is recorded on the profile rather than in localStorage: this announces that the rules of
// the app changed, and a second phone is not a second person who needs telling twice — nor should
// clearing site data resurrect it. The key itself lives in src/domain/announcement.ts, because the
// server component that decides whether to render this sheet cannot read a constant out of a
// "use client" module.

const LINES: { icon: string; title: string; body: string }[] = [
  {
    icon: "🚗",
    title: "No more Start or End",
    body: "A ride counts itself at its departure time. Your points land then — nothing to tap.",
  },
  {
    icon: "⏱️",
    title: "A reminder 15 minutes before",
    body: "Driver and riders get a nudge before the car leaves, and again before the ride home.",
  },
  {
    icon: "✍️",
    title: "Drivers: fix the list until tonight",
    body: "Someone didn't show? Report them — they lose 5 points, you get 2. Someone rode without booking? Add them.",
  },
  {
    icon: "🅿️",
    title: "Drivers: the parking link comes to you",
    body: "30 minutes after every ride you drive, a notification with your group's parking link — tap it to pay.",
  },
  {
    icon: "💚",
    title: "Kudos sits on the ride",
    body: "Once a ride has left, its card is where you thank your driver.",
  },
  {
    icon: "💬",
    title: "Every ride has a chat",
    body: "The driver and everyone with a seat can talk on the trip itself.",
  },
];

export function WhatsNewSheet({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState(false);

  async function dismiss() {
    setBusy(true);
    try {
      // Fire and forget by design: the sheet closes either way. A failed write costs one repeat
      // showing on the next visit, which is a far smaller harm than a sheet that will not close.
      await fetch("/api/me/announcement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: ANNOUNCEMENT_KEY }),
      });
    } catch {
      // ignored — see above
    } finally {
      setBusy(false);
      onClose();
    }
  }

  return (
    <div className="sheet" onClick={dismiss}>
      <div className="sheetc" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ font: "800 19px var(--font-display)", color: "var(--ink)", margin: "0 0 4px" }}>
          What&apos;s new
        </h3>
        <p style={{ font: "600 12.5px/1.5 var(--font-body)", color: "rgba(0,0,0,.5)", margin: "0 0 16px" }}>
          Rides now run themselves. Here&apos;s what changed.
        </p>

        {LINES.map((line) => (
          <div
            key={line.title}
            style={{
              display: "flex",
              gap: 11,
              alignItems: "flex-start",
              background: "var(--surface)",
              border: "1px solid var(--hairline)",
              borderRadius: 14,
              padding: "11px 12px",
              marginBottom: 8,
            }}
          >
            <span style={{ fontSize: 18, lineHeight: 1.2, flex: "none" }} aria-hidden>
              {line.icon}
            </span>
            <div>
              <div style={{ font: "700 13px var(--font-body)", color: "var(--ink)" }}>{line.title}</div>
              <div style={{ font: "600 11.5px/1.45 var(--font-body)", color: "rgba(0,0,0,.5)", marginTop: 2 }}>
                {line.body}
              </div>
            </div>
          </div>
        ))}

        <button className="btnP" disabled={busy} onClick={dismiss} style={{ marginTop: 10 }}>
          Got it
        </button>
      </div>
    </div>
  );
}
