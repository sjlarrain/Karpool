"use client";

import { useState } from "react";
import { ANNOUNCEMENT_KEY } from "@/domain/announcement";

// D-61 (developer, 2026-09-19: "a notification message for the users that get into the platform so
// they can check this new things. Sort of a pop up"). Shown up to ANNOUNCEMENT_MAX_VIEWS times per
// person (2, on the developer's follow-up the same day: "it needs to appear twice") — once wasn't
// enough for a change this size to register with someone skimming past it.
//
// The view count is recorded on the profile rather than in localStorage: this announces that the
// rules of the app changed, and a second phone is not a second person who needs telling from
// scratch — nor should clearing site data reset the count. The key and the max live in
// src/domain/announcement.ts, because the server component that decides whether to render this
// sheet cannot read a constant out of a "use client" module.

const LINES: { icon: string; title: string; body: string }[] = [
  {
    icon: "🔔",
    title: "Get told when a new ride is published",
    body: "This is off until you turn it on. Go to You → Ride alerts, switch it On and add the times you usually travel. Then you'll be notified when someone publishes a ride with free seats around those times, and when a full ride gets a seat back.",
  },
  {
    icon: "⏰",
    title: "Drivers: couldn't leave? Postpone",
    body: "If a ride counted itself but you never left, open it and tap Postpone to move it to later today. Your riders keep their seats and are told the new time, and it counts when you actually go.",
  },
  {
    icon: "🙋",
    title: "Riders: a postponed ride is free to leave",
    body: "If the new time doesn't work for you, you can drop out with no points lost.",
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
          Two new things in Karpool.
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
