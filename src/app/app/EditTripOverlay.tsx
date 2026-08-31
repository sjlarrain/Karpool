"use client";

import { useState } from "react";
import { SEATS } from "@/domain/constants";
import type { TripStopView } from "@/domain/types";
import { StopPicker } from "./StopSign";
import { readJsonBody, UNREADABLE_REPLY } from "@/lib/http/readJsonBody";

// D-38. The driver's own trip, still scheduled, opened for a change of plan. Deliberately narrower
// than "Offer a trip": the day, the times, the seats and the stops move — the direction does not.
// Turning an outbound into a return is not an edit of the ride people joined, it is a different
// ride, and the honest way to do that is to cancel this one and publish that one.
interface Props {
  tripId: string;
  direction: string;
  departAt: string;
  returnAt: string | null;
  capacity: number;
  outStopId: string | null;
  backStopId: string | null;
  stops: TripStopView[];
  // People already in the car. The seat counter can't go below them, and their presence is why the
  // banner warns about the free drop-out.
  seatedCount: number;
  onClose: () => void;
  onSaved: (message: string) => void;
}

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function isoTime(d: Date) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function EditTripOverlay({
  tripId,
  direction,
  departAt,
  returnAt,
  capacity: initialCapacity,
  outStopId: initialOutStopId,
  backStopId: initialBackStopId,
  stops,
  seatedCount,
  onClose,
  onSaved,
}: Props) {
  // Stored instants rendered in the reader's own zone, the same way the cards render them (D-37) —
  // a driver who published 07:45 must see 07:45 in the form they open to change it.
  const departLocal = new Date(departAt);
  const returnLocal = returnAt ? new Date(returnAt) : null;

  const [departDate, setDepartDate] = useState(isoDate(departLocal));
  const [departTime, setDepartTime] = useState(isoTime(departLocal));
  const [returnTime, setReturnTime] = useState(returnLocal ? isoTime(returnLocal) : "17:30");
  const [capacity, setCapacity] = useState(initialCapacity);
  const [outStopId, setOutStopId] = useState(initialOutStopId ?? "");
  const [backStopId, setBackStopId] = useState(initialBackStopId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRound = direction === "round";
  const hasStops = stops.length > 0;
  // A seat can't be taken back out from under someone already sitting in it.
  const minCapacity = Math.max(SEATS.min, seatedCount);

  function at(date: string, time: string) {
    const [y, mo, day] = date.split("-").map(Number);
    const [h, m] = time.split(":").map(Number);
    const d = new Date();
    d.setFullYear(y ?? d.getFullYear(), (mo ?? 1) - 1, day ?? d.getDate());
    d.setHours(h ?? 0, m ?? 0, 0, 0);
    return d.toISOString();
  }

  async function save() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/trips/${tripId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          departAt: at(departDate, departTime),
          ...(isRound && { returnAt: at(departDate, returnTime) }),
          capacity,
          // Only send a stop field the trip's own leg can carry, and only when the group keeps a
          // stop list at all — sending null to a group that never used stops would be an edit
          // nobody asked for.
          ...(hasStops && direction !== "back" && { outStopId: outStopId || null }),
          ...(hasStops && direction !== "out" && { backStopId: backStopId || null }),
        }),
      });
      const body = await readJsonBody<{ changed?: string[]; notifiedRiders?: number }>(res);
      if (!res.ok) {
        setError(body?.message ?? "Couldn't save those changes.");
        return;
      }
      if (!body) {
        setError(UNREADABLE_REPLY);
        return;
      }
      const changed: string[] = body.changed ?? [];
      const notified: number = body.notifiedRiders ?? 0;
      onSaved(
        changed.length === 0
          ? "Nothing changed"
          : notified > 0
            ? `Trip updated — ${notified} rider${notified === 1 ? "" : "s"} notified`
            : "Trip updated",
      );
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
        <h2 style={{ fontSize: 18, fontWeight: 800, color: "var(--ink)", margin: 0 }}>Edit trip</h2>
      </div>
      <div className="scroll" style={{ padding: 18 }}>
        {seatedCount > 0 && (
          <div
            style={{
              background: "var(--amber-soft)",
              border: "1px solid rgba(255,176,32,.4)",
              borderRadius: 13,
              padding: "11px 12px",
              font: "500 11.5px var(--font-body)",
              lineHeight: 1.45,
              color: "var(--amber-ink)",
              marginBottom: 18,
            }}
          >
            ⚠️ {seatedCount === 1 ? "1 rider is" : `${seatedCount} riders are`} counting on this trip. Move the time or a
            stop and they&apos;re notified — and they can leave with <b>no points lost</b>.
          </div>
        )}

        <div style={{ marginBottom: 12 }}>
          <label className="lbl">Day</label>
          <input
            className="field"
            type="date"
            value={departDate}
            onChange={(e) => setDepartDate(e.target.value || departDate)}
          />
        </div>

        <div style={{ display: "flex", gap: 12, marginBottom: 18 }}>
          <div style={{ flex: 1 }}>
            <label className="lbl">Departs</label>
            <input className="field" type="time" value={departTime} onChange={(e) => setDepartTime(e.target.value)} />
          </div>
          {isRound && (
            <div style={{ flex: 1 }}>
              <label className="lbl">Returns</label>
              <input className="field" type="time" value={returnTime} onChange={(e) => setReturnTime(e.target.value)} />
            </div>
          )}
        </div>

        <label className="lbl">Seats available</label>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            background: "var(--surface)",
            border: "1px solid rgba(0,0,0,.1)",
            borderRadius: 13,
            padding: "9px 14px",
            marginBottom: 6,
          }}
        >
          <button
            onClick={() => setCapacity((c) => Math.max(minCapacity, c - 1))}
            disabled={capacity <= minCapacity}
            aria-label="One seat fewer"
            style={{
              width: 34,
              height: 34,
              borderRadius: 11,
              border: "none",
              background: "var(--chip)",
              fontSize: 20,
              fontWeight: 700,
              cursor: capacity > minCapacity ? "pointer" : "not-allowed",
              opacity: capacity > minCapacity ? 1 : 0.4,
            }}
          >
            −
          </button>
          <div style={{ flex: 1, textAlign: "center", font: "800 20px var(--font-display)", color: "var(--ink)" }}>
            {capacity}
          </div>
          <button
            onClick={() => setCapacity((c) => Math.min(SEATS.max, c + 1))}
            aria-label="One seat more"
            style={{
              width: 34,
              height: 34,
              borderRadius: 11,
              border: "none",
              background: "var(--chip)",
              fontSize: 20,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            +
          </button>
        </div>
        <p style={{ font: "500 11px var(--font-body)", color: "rgba(0,0,0,.4)", margin: "0 2px 18px" }}>
          {seatedCount > 0
            ? `Can't go below ${minCapacity} — that's who is already riding.`
            : "Nobody has joined yet, so any number works."}
        </p>

        {hasStops && (
          <>
            <label className="lbl">Stops on the way</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 6 }}>
              {direction !== "back" && (
                <StopPicker
                  label={isRound ? "Going" : "On the way"}
                  stops={stops}
                  value={outStopId}
                  onChange={setOutStopId}
                />
              )}
              {direction !== "out" && (
                <StopPicker
                  label={isRound ? "Coming back" : "On the way back"}
                  stops={stops}
                  value={backStopId}
                  onChange={setBackStopId}
                />
              )}
            </div>
            <p style={{ font: "500 11px var(--font-body)", color: "rgba(0,0,0,.4)", margin: "0 2px 18px" }}>
              Clear a stop to go direct. The whole car stops where you choose.
            </p>
          </>
        )}

        {error && <p style={{ color: "var(--danger)", font: "600 12px var(--font-body)", margin: "0 0 12px" }}>{error}</p>}
        <button className="btnP" disabled={busy} onClick={save}>
          Save changes
        </button>
        <button className="btnG" style={{ marginTop: 10 }} onClick={onClose} disabled={busy}>
          Never mind
        </button>
      </div>
    </div>
  );
}
