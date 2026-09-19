"use client";

import { useState } from "react";
import { readJsonBody } from "@/lib/http/readJsonBody";

// D-61 — what is left of the close screen, and it is a correction, not a ceremony.
//
// The ride was counted and paid when it departed, with every booked seat treated as ridden. This is
// where the driver says otherwise, until the end of that day:
//
//   - someone booked and didn't ride  → reported as a no-show: -5 for them, +2 for the driver
//   - someone rode without booking    → seated now, which pays the driver that seat's bonus
//   - a seat the DRIVER added went unused → simply freed, and the driver is no longer paid for it.
//     Nobody is charged for a seat they never asked for (D-24's principle, applied after the fact).
//
// There is no undo: points_ledger is append-only, so a report is a fact once written. Hence the
// two-tap confirm on the only destructive action here.

interface Rider {
  id: string; // trip_rider row id
  name: string;
  initials?: string;
  color?: string;
  addedByDriver: boolean;
  isGuest: boolean;
  groupGuestId: string | null;
}

interface Props {
  tripId: string;
  riders: Rider[];
  // D-55: the group's guest roster, minus anyone already aboard. Picking one records the ride under
  // an identity that accumulates, where the typed name below records a name and nothing else.
  addableGuests: { id: string; name: string; initials: string; color: string }[];
  onClose: () => void;
  onFixed: (message: string) => void;
}

export function FixRideListOverlay({ tripId, riders, addableGuests, onClose, onFixed }: Props) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [guestName, setGuestName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One request helper for all four actions: they differ only in where they point and what the
  // toast says, and every one of them ends the sheet.
  async function send(path: string, init: RequestInit, message: (body: Record<string, unknown> | null) => string) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(path, init);
      const body = await readJsonBody<Record<string, unknown>>(res);
      if (!res.ok) {
        setError((body?.message as string) ?? "That didn't work. Reopen the ride to check before trying again.");
        return;
      }
      onFixed(message(body));
    } catch {
      setError("Couldn't reach the server — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const json = (payload: unknown): RequestInit => ({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  function reportNoShow(rider: Rider) {
    void send(`/api/trips/${tripId}/no-show`, json({ tripRiderId: rider.id }), (body) => {
      const driverPoints = typeof body?.driverPoints === "number" ? body.driverPoints : 0;
      return `${rider.name} marked as a no-show · +${driverPoints} pts for reporting`;
    });
  }

  function removeSeat(rider: Rider) {
    const path = rider.groupGuestId
      ? `/api/trips/${tripId}/guests/${rider.id}`
      : `/api/trips/${tripId}/riders/${rider.id}`;
    void send(path, { method: "DELETE" }, () => `${rider.name} taken off this ride`);
  }

  function seatRosterGuest(guest: { id: string; name: string }) {
    void send(`/api/trips/${tripId}/guests`, json({ groupGuestId: guest.id }), (body) => {
      const delta = typeof body?.pointsAdjusted === "number" ? body.pointsAdjusted : 0;
      return delta > 0 ? `${guest.name} added · +${delta} pts` : `${guest.name} added`;
    });
  }

  function seatTypedGuest() {
    const name = guestName.trim();
    if (!name) return;
    void send(`/api/trips/${tripId}/guests`, json({ guestName: name }), (body) => {
      const delta = typeof body?.pointsAdjusted === "number" ? body.pointsAdjusted : 0;
      return delta > 0 ? `${name} added · +${delta} pts` : `${name} added`;
    });
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
        <h2 style={{ fontSize: 18, fontWeight: 800, color: "var(--ink)", margin: 0 }}>Fix the ride list</h2>
      </div>

      <div className="scroll" style={{ padding: 18 }}>
        <p style={{ font: "600 13px var(--font-body)", lineHeight: 1.5, color: "rgba(0,0,0,.55)", margin: "0 0 16px" }}>
          Everyone below was counted as riding, and you&apos;ve been paid for their seats. Only change
          what&apos;s actually wrong — you can do this until the end of today.
        </p>

        {riders.length > 0 && (
          <>
            <label className="lbl">Who was counted</label>
            {riders.map((r) => {
              const confirming = confirmingId === r.id;
              // A seat the rider booked themselves is the only one worth points to report: the
              // others were the driver's own doing, so they are freed rather than charged.
              const reportable = !r.isGuest && !r.addedByDriver;
              const removable = r.addedByDriver;
              return (
                <div
                  key={r.id}
                  style={{
                    background: "var(--surface)",
                    border: `1px solid ${confirming ? "rgba(192,57,43,.35)" : "rgba(0,0,0,.08)"}`,
                    borderRadius: 14,
                    padding: "11px 12px",
                    marginBottom: 8,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                    <span className="av" style={{ background: r.color ?? "var(--teal)" }}>
                      {r.initials ?? r.name.slice(0, 2).toUpperCase()}
                    </span>
                    <div style={{ flex: 1 }}>
                      <div style={{ font: "700 13px var(--font-body)", color: "var(--ink)" }}>{r.name}</div>
                      <div style={{ font: "600 11px var(--font-body)", color: "rgba(0,0,0,.45)" }}>
                        {r.isGuest ? "Guest" : r.addedByDriver ? "Added by you" : "Booked their own seat"}
                      </div>
                    </div>
                    {reportable && !confirming && (
                      <button
                        onClick={() => setConfirmingId(r.id)}
                        disabled={busy}
                        style={{
                          background: "none",
                          border: "none",
                          color: "var(--danger)",
                          font: "700 11.5px var(--font-body)",
                          cursor: "pointer",
                          padding: 4,
                        }}
                      >
                        Didn&apos;t show
                      </button>
                    )}
                    {removable && (
                      <button
                        onClick={() => removeSeat(r)}
                        disabled={busy}
                        style={{
                          background: "none",
                          border: "none",
                          color: "rgba(0,0,0,.4)",
                          font: "700 11.5px var(--font-body)",
                          cursor: "pointer",
                          padding: 4,
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </div>

                  {confirming && (
                    <div style={{ marginTop: 10 }}>
                      <div
                        style={{
                          font: "600 11.5px/1.45 var(--font-body)",
                          color: "rgba(0,0,0,.55)",
                          marginBottom: 8,
                        }}
                      >
                        {r.name} booked a seat and didn&apos;t ride? They lose 5 points and you get 2
                        for telling us. This can&apos;t be undone.
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          className="btnG"
                          disabled={busy}
                          onClick={() => setConfirmingId(null)}
                          style={{ flex: 1 }}
                        >
                          Keep them
                        </button>
                        <button
                          className="btnG"
                          disabled={busy}
                          onClick={() => reportNoShow(r)}
                          style={{
                            flex: 1,
                            background: "var(--surface)",
                            color: "var(--danger)",
                            border: "1px solid rgba(192,57,43,.3)",
                          }}
                        >
                          Report no-show
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}

        {addableGuests.length > 0 && (
          <>
            <label className="lbl" style={{ marginTop: 14 }}>
              Someone else rode?
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
              {addableGuests.map((g) => (
                <button
                  key={g.id}
                  onClick={() => seatRosterGuest(g)}
                  disabled={busy}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    background: "var(--surface)",
                    border: "1px solid rgba(0,0,0,.1)",
                    borderRadius: 999,
                    padding: "5px 10px 5px 5px",
                    font: "700 11.5px var(--font-body)",
                    color: "var(--ink)",
                    cursor: "pointer",
                  }}
                >
                  <span className="av" style={{ background: g.color, width: 24, height: 24, borderRadius: 8, fontSize: 10 }}>
                    {g.initials}
                  </span>
                  {g.name}
                </button>
              ))}
            </div>
            <p style={{ font: "500 11px var(--font-body)", color: "rgba(0,0,0,.4)", margin: "2px 2px 8px" }}>
              Guests from your group&apos;s list. Their rides add up under their name.
            </p>
          </>
        )}

        <label className="lbl" style={{ marginTop: 14 }}>
          A one-off guest
        </label>
        <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
          <input
            className="field"
            placeholder="Name of someone who rode"
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && seatTypedGuest()}
          />
          <button
            onClick={seatTypedGuest}
            disabled={busy || !guestName.trim()}
            style={{
              background: "var(--ink)",
              color: "var(--surface)",
              border: "none",
              borderRadius: 13,
              padding: "0 16px",
              fontWeight: 800,
              cursor: busy || !guestName.trim() ? "not-allowed" : "pointer",
              opacity: busy || !guestName.trim() ? 0.5 : 1,
            }}
          >
            Add
          </button>
        </div>
        <p style={{ font: "500 11px var(--font-body)", color: "rgba(0,0,0,.4)", margin: "2px 2px 20px" }}>
          Just this once — a typed name fills a seat and pays you for it, but isn&apos;t tracked for
          anyone. Ask an admin to add a regular rider to the guest list instead.
        </p>

        {error && <p style={{ color: "var(--danger)", font: "600 12px var(--font-body)", margin: "0 0 12px" }}>{error}</p>}

        <button className="btnP" disabled={busy} onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
