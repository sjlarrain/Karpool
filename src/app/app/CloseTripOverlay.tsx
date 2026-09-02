"use client";

import { useState } from "react";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { ParkingLink } from "./ParkingLink";

interface Rider {
  id: string; // trip_rider row id
  name: string;
  initials?: string;
  color?: string;
}

interface Props {
  tripId: string;
  riders: Rider[];
  // D-54: the parking link for the leg just driven. Null when the group has not set one for this
  // direction, and always null for anyone but the driver — the server never sends it to a rider.
  parkingUrl: string | null;
  // D-55: the group's guest roster, minus anyone already aboard. Picking one here records the
  // ride under an identity that accumulates, where the free-text field below records a name and
  // nothing else.
  addableGuests: { id: string; name: string; initials: string; color: string }[];
  onClose: () => void;
  onClosed: (message: string) => void;
}

export function CloseTripOverlay({ tripId, riders, parkingUrl, addableGuests, onClose, onClosed }: Props) {
  const [checks, setChecks] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(riders.map((r) => [r.id, true])),
  );
  const [guestNames, setGuestNames] = useState<string[]>([]);
  const [pickedGuestIds, setPickedGuestIds] = useState<string[]>([]);
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
        body: JSON.stringify({ confirmedTripRiderIds, guestNames, groupGuestIds: pickedGuestIds }),
      });

      // Parsed defensively — see src/lib/http/readJsonBody.ts. This is the handler that taught us
      // why: an unhandled fault here returns an HTML error page, `res.json()` threw, and the driver
      // was told to check their connection while the trip was being half-closed and they were
      // double-paid on every retry.
      const body = await readJsonBody<{ pointsAwarded: number }>(res);

      if (!res.ok) {
        setError(body?.message ?? "Something went wrong closing that trip. It may already be closed — reopen it to check before trying again.");
        return;
      }
      if (!body) {
        setError("The trip may have closed even though this failed — reopen it to check before trying again.");
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
          Confirm who rode with you. Everyone confirmed counts toward your drive bonus and gets a nudge to leave you kudos.
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

        {/* D-55: the roster comes first and the free-text field is demoted below it. A driver
            reaching for the quickest option should land on the one that counts — free text is
            what left the developer with untracked riders in the first place. */}
        {addableGuests.length > 0 && (
          <>
            <label className="lbl" style={{ marginTop: 14 }}>
              Anyone else from the guest list?
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
              {addableGuests.map((g) => {
                const picked = pickedGuestIds.includes(g.id);
                return (
                  <button
                    key={g.id}
                    aria-pressed={picked}
                    onClick={() =>
                      setPickedGuestIds((ids) => (picked ? ids.filter((x) => x !== g.id) : [...ids, g.id]))
                    }
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 7,
                      background: picked ? "var(--green-soft)" : "var(--surface)",
                      border: `1.5px solid ${picked ? "var(--green)" : "rgba(0,0,0,.1)"}`,
                      borderRadius: 13,
                      padding: "7px 11px 7px 7px",
                      cursor: "pointer",
                      font: "700 12px var(--font-body)",
                      color: "var(--ink)",
                    }}
                  >
                    <span className="av" style={{ background: g.color, width: 24, height: 24, borderRadius: 8, fontSize: 10 }}>
                      {g.initials}
                    </span>
                    {g.name}
                    {picked && <span style={{ color: "var(--green-ink)" }}>✓</span>}
                  </button>
                );
              })}
            </div>
            <p style={{ font: "500 11px var(--font-body)", color: "rgba(0,0,0,.4)", margin: "2px 2px 8px" }}>
              Their rides add up, and can be handed to their account if they sign up.
            </p>
          </>
        )}

        <label className="lbl" style={{ marginTop: 14 }}>
          Someone else, just this once?
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
          A one-off name fills a seat, so it still counts toward your drive bonus — but it is not
          tracked for anyone. Ask an admin to add a regular rider to the guest list instead.
        </p>

        {/* D-54: the developer asked for this "in the close trip button" — the driver has just
            parked, and this is the screen they are already on. */}
        <ParkingLink url={parkingUrl} hint="Pay for parking" />

        {error && <p style={{ color: "var(--danger)", font: "600 12px var(--font-body)", margin: "0 0 12px" }}>{error}</p>}
        <button className="btnP" disabled={busy} onClick={confirmClose}>
          Close &amp; notify riders
        </button>
      </div>
    </div>
  );
}
