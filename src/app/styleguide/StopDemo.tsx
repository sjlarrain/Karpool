"use client";

import { useState } from "react";
import { STOP_ICONS } from "@/domain/types";
import type { StopIcon, TripStopView } from "@/domain/types";
import { StopGlyph, StopMention, StopPicker } from "../app/StopSign";

// D-29 primitives. Renders the *real* components with mock props rather than a copy of their
// markup — the styleguide's whole job is to be compared against, and a copy stops being comparable
// the first time the real one changes.

const DEMO_STOPS: TripStopView[] = [
  { id: "s1", label: "Gym", icon: "gym", address: "Fitness Park, Sepulveda" },
  { id: "s2", label: "Pool", icon: "pool", address: "Aquatic centre, Gate 3" },
  { id: "s3", label: "Coffee", icon: "coffee", address: "Blue Bottle, Abbot Kinney" },
];

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ font: "700 10px var(--font-body)", color: "rgba(0,0,0,.4)", textTransform: "uppercase", marginBottom: 8 }}>
      {children}
    </div>
  );
}

export function StopDemo() {
  // The create form's own state, mirrored: a round trip offers a picker per leg, and the driver may
  // leave either empty.
  const [outStop, setOutStop] = useState("s1");
  const [backStop, setBackStop] = useState("");

  const selectedOut = DEMO_STOPS.find((s) => s.id === outStop) ?? null;
  const selectedBack = DEMO_STOPS.find((s) => s.id === backStop) ?? null;

  const notices = [
    ...(selectedOut ? [{ stop: selectedOut, leg: "out" as const, when: "in way" }] : []),
    ...(selectedBack ? [{ stop: selectedBack, leg: "back" as const, when: "back" }] : []),
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <div>
        <Label>Stop icons — the fixed vocabulary a group admin picks from</Label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
          {STOP_ICONS.map((name: StopIcon) => (
            <span
              key={name}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                background: "var(--amber-soft)",
                color: "var(--amber-ink)",
                padding: "3px 9px",
                borderRadius: 20,
                font: "700 11px var(--font-body)",
              }}
            >
              <StopGlyph icon={name} size={14} />
              {name}
            </span>
          ))}
        </div>
      </div>

      <div>
        <Label>Add trip — stop pickers (round trip shows one per leg)</Label>
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid rgba(0,0,0,.08)",
            borderRadius: 14,
            padding: 14,
          }}
        >
          <div style={{ font: "700 11px var(--font-body)", color: "rgba(0,0,0,.45)", marginBottom: 10 }}>
            Stops on the way
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <StopPicker label="Going" stops={DEMO_STOPS} value={outStop} onChange={setOutStop} />
            <StopPicker label="Coming back" stops={DEMO_STOPS} value={backStop} onChange={setBackStop} />
          </div>
          <p style={{ font: "500 11px var(--font-body)", color: "rgba(0,0,0,.4)", margin: "10px 2px 0" }}>
            The whole car stops here. Riders see it on the trip card.
          </p>
        </div>
        <p style={{ font: "500 11px var(--font-body)", color: "rgba(0,0,0,.4)", margin: "8px 2px 0" }}>
          A one-way trip shows only the leg it travels. A group with no stops sees none of this.
        </p>
      </div>

      <div>
        <Label>What the card then shows — change the pickers above</Label>
        <div className="card" style={{ borderLeftColor: "var(--purple)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 9 }}>
            <span className="pill" style={{ color: "var(--purple)", background: "var(--purple-soft)" }}>
              YOU&apos;RE DRIVING
            </span>
            <span style={{ font: "800 14px var(--font-display)", color: "var(--ink)" }}>7:45</span>
          </div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <div className="route" style={{ minWidth: 0 }}>
              Riverside <span style={{ color: "rgba(0,0,0,.3)" }}>→</span> HQ
            </div>
            <StopMention notices={notices} />
          </div>
          <div style={{ font: "600 12px var(--font-body)", color: "rgba(0,0,0,.5)", marginTop: 4 }}>
            You&apos;re driving
          </div>
        </div>
        {notices.length === 0 && (
          <p style={{ font: "500 11px var(--font-body)", color: "rgba(0,0,0,.4)", margin: "8px 2px 0" }}>
            No stop selected — a direct ride shows nothing at all.
          </p>
        )}
      </div>
    </div>
  );
}
