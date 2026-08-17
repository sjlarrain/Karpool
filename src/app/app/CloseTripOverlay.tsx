"use client";

import { useState } from "react";

interface Rider {
  id: string; // trip_rider row id
  name: string;
  initials?: string;
  color?: string;
}

interface Props {
  tripId: string;
  riders: Rider[];
  onClose: () => void;
  onClosed: (message: string) => void;
}

export function CloseTripOverlay({ tripId, riders, onClose, onClosed }: Props) {
  const [checks, setChecks] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(riders.map((r) => [r.id, true])),
  );
  const [guestNames, setGuestNames] = useState<string[]>([]);
  const [newGuest, setNewGuest] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addGuest() {
    const name = newGuest.trim();
    if (!name) return;
    setGuestNames((g) => [...g, name]);
    setNewGuest("");
  }

  async function confirmClose() {
    setError(null);
    setBusy(true);
    try {
      const confirmedTripRiderIds = riders.filter((r) => checks[r.id]).map((r) => r.id);
      const res = await fetch(`/api/trips/${tripId}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmedTripRiderIds, guestNames }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.message ?? "Couldn't close that trip.");
        return;
      }
      onClosed(`Trip closed · +${body.pointsAwarded} pts, riders notified`);
    } catch {
      setError("Couldn't reach the server — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ov">
      <div
        style={{
          padding: "44px 18px 12px",
          flex: "none",
          display: "flex",
          alignItems: "center",
          gap: 12,
          borderBottom: "1px solid rgba(0,0,0,.06)",
        }}
      >
        <button className="iconbtn" onClick={onClose} aria-label="Back">
          ←
        </button>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: "var(--ink)", margin: 0 }}>Close trip</h2>
      </div>
      <div className="scroll" style={{ padding: 18 }}>
        <p style={{ font: "600 13px var(--font-body)", lineHeight: 1.5, color: "rgba(0,0,0,.55)", margin: "0 0 16px" }}>
          Confirm who rode with you. Everyone confirmed gets pooled points and a nudge to leave you kudos.
        </p>

        {riders.length > 0 && (
          <>
            <label className="lbl">Riders</label>
            {riders.map((r) => {
              const on = checks[r.id] !== false;
              return (
                <button
                  key={r.id}
                  onClick={() => setChecks((c) => ({ ...c, [r.id]: !on }))}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 11,
                    background: "var(--surface)",
                    border: `1px solid ${on ? "rgba(23,201,100,.45)" : "rgba(0,0,0,.08)"}`,
                    borderRadius: 14,
                    padding: "11px 12px",
                    marginBottom: 8,
                    cursor: "pointer",
                  }}
                >
                  <span className="av" style={{ background: r.color ?? "var(--teal)" }}>
                    {r.initials ?? r.name.slice(0, 2).toUpperCase()}
                  </span>
                  <div style={{ flex: 1, textAlign: "left", font: "700 13px var(--font-body)", color: "var(--ink)" }}>
                    {r.name}
                  </div>
                  <span
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: "50%",
                      background: on ? "var(--green)" : "rgba(0,0,0,.12)",
                      color: "var(--surface)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 13,
                      flex: "none",
                    }}
                  >
                    {on ? "✓" : ""}
                  </span>
                </button>
              );
            })}
          </>
        )}

        <label className="lbl" style={{ marginTop: 14 }}>
          Drove someone not in the group?
        </label>
        <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
          <input
            className="field"
            placeholder="Add a guest rider's name"
            value={newGuest}
            onChange={(e) => setNewGuest(e.target.value)}
          />
          <button
            onClick={addGuest}
            style={{
              background: "var(--ink)",
              color: "var(--surface)",
              border: "none",
              borderRadius: 13,
              padding: "0 16px",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Add
          </button>
        </div>
        {guestNames.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
            {guestNames.map((name, i) => (
              <span
                key={i}
                className="pill"
                style={{ color: "rgba(0,0,0,.6)", background: "var(--chip)", display: "flex", alignItems: "center", gap: 6 }}
              >
                {name}
                <button
                  onClick={() => setGuestNames((g) => g.filter((_, j) => j !== i))}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", fontSize: 11, padding: 0 }}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
        <p style={{ font: "500 11px var(--font-body)", color: "rgba(0,0,0,.4)", margin: "2px 2px 20px" }}>
          Guest riders still count toward your pooled score.
        </p>

        {error && <p style={{ color: "var(--danger)", font: "600 12px var(--font-body)", margin: "0 0 12px" }}>{error}</p>}
        <button className="btnP" disabled={busy} onClick={confirmClose}>
          Close &amp; notify riders
        </button>
      </div>
    </div>
  );
}
