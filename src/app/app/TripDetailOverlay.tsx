"use client";

import { useEffect, useState, useCallback } from "react";
import type { DecoratedTrip } from "@/domain/decorateTrip";
import { CloseTripOverlay } from "./CloseTripOverlay";

interface Pickup {
  id: string;
  name: string;
  initials?: string;
  color?: string;
  pickupLabel: string | null;
  stopOrder: number | null;
  isViewer: boolean;
}

interface DetailResponse {
  trip: DecoratedTrip;
  driverId: string;
  isDriver: boolean;
  cancelledReason: string | null;
  pickups: Pickup[];
  viewerGaveKudos: boolean;
}

interface Props {
  tripId: string;
  onClose: () => void;
  onChanged: (message: string) => void;
}

export function TripDetailOverlay({ tripId, onClose, onChanged }: Props) {
  const [data, setData] = useState<DetailResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [closing, setClosing] = useState(false);
  const [kudosComment, setKudosComment] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/trips/${tripId}`);
      if (!res.ok) throw new Error(`status ${res.status}`);
      setData(await res.json());
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, [tripId]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(path: string, message: string) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/trips/${tripId}/${path}`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setError(body.message ?? "That didn't work.");
        return;
      }
      setConfirmingLeave(false);
      await load();
      onChanged(message);
    } catch {
      setError("Couldn't reach the server — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function giveKudos() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/trips/${tripId}/kudos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment: kudosComment.trim() || undefined }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.message ?? "Couldn't send kudos.");
        return;
      }
      await load();
      onChanged("Kudos sent 💚");
    } catch {
      setError("Couldn't reach the server — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <div className="ov">
        <div style={{ padding: "44px 18px 0", flex: "none", display: "flex", alignItems: "center", gap: 12 }}>
          <button className="iconbtn" onClick={onClose} aria-label="Back">
            ←
          </button>
        </div>
        {loadFailed && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10 }}>
            <p style={{ font: "600 12.5px var(--font-body)", color: "rgba(0,0,0,.45)" }}>Couldn&apos;t load this trip.</p>
            <button className="btnG" style={{ width: "auto", padding: "10px 20px" }} onClick={load}>
              Retry
            </button>
          </div>
        )}
      </div>
    );
  }

  const { trip, isDriver, pickups } = data;
  const otherPickups = pickups.filter((p) => !p.isViewer);

  return (
    <div className="ov">
      <div style={{ padding: "44px 18px 0", flex: "none", display: "flex", alignItems: "center", gap: 12 }}>
        <button className="iconbtn" onClick={onClose}>
          ←
        </button>
        <span className="pill" style={{ color: trip.badgeColor, background: trip.badgeBg }}>
          {trip.badge}
        </span>
      </div>
      <div className="scroll" style={{ padding: "14px 18px 18px" }}>
        <div
          style={{
            position: "relative",
            height: 158,
            borderRadius: 18,
            overflow: "hidden",
            marginBottom: 16,
            background: "#e8ede7",
          }}
        >
          <svg viewBox="0 0 320 160" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
            <rect width="320" height="160" fill="#eef1ea" />
            <path d="M40 130 C 110 110, 120 60, 200 55 S 280 40, 285 32" fill="none" stroke="#17c964" strokeWidth={4} strokeLinecap="round" strokeDasharray="1 9" />
            <circle cx={40} cy={130} r={7} fill="#7c5cff" stroke="#fff" strokeWidth={2.5} />
            <circle cx={285} cy={32} r={7} fill="#16181d" stroke="#fff" strokeWidth={2.5} />
          </svg>
          <span
            style={{
              position: "absolute",
              top: 10,
              left: 12,
              background: "rgba(255,255,255,.9)",
              borderRadius: 8,
              padding: "4px 9px",
              font: "700 10px var(--font-body)",
              color: "var(--ink)",
            }}
          >
            🗺️ Route preview
          </span>
        </div>

        <h2 style={{ fontSize: 22, fontWeight: 800, color: "var(--ink)", margin: 0, lineHeight: 1.1 }}>
          {trip.from} → {trip.to}
        </h2>

        <div style={{ display: "flex", gap: 16, margin: "12px 0 18px" }}>
          <div>
            <div style={{ font: "600 10px var(--font-body)", color: "rgba(0,0,0,.4)", textTransform: "uppercase" }}>Departs</div>
            <div style={{ font: "800 17px var(--font-display)", color: "var(--ink)" }}>{trip.time}</div>
          </div>
          {trip.returnTime && (
            <div>
              <div style={{ font: "600 10px var(--font-body)", color: "rgba(0,0,0,.4)", textTransform: "uppercase" }}>Returns</div>
              <div style={{ font: "800 17px var(--font-display)", color: "var(--ink)" }}>{trip.returnTime}</div>
            </div>
          )}
          <div>
            <div style={{ font: "600 10px var(--font-body)", color: "rgba(0,0,0,.4)", textTransform: "uppercase" }}>Seats</div>
            <div style={{ font: "800 17px var(--font-display)", color: trip.seatColor }}>{trip.seatStr}</div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 11,
            background: "var(--surface)",
            border: "1px solid rgba(0,0,0,.07)",
            borderRadius: 15,
            padding: 12,
            marginBottom: 16,
          }}
        >
          <span className="av" style={{ width: 38, height: 38, borderRadius: 12, background: "var(--purple)", fontSize: 13 }}>
            {isDriver ? "You" : trip.driver.slice(0, 2).toUpperCase()}
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ font: "700 14px var(--font-display)", color: "var(--ink)" }}>{trip.driver}</div>
            <div style={{ font: "600 11px var(--font-body)", color: "rgba(0,0,0,.45)" }}>
              Driver{isDriver ? " · that's you" : ""}
            </div>
          </div>
        </div>

        {error && <p style={{ color: "var(--danger)", font: "600 12px var(--font-body)", margin: "0 0 12px" }}>{error}</p>}

        {isDriver && (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 9 }}>
              <h3 style={{ fontSize: 14, fontWeight: 800, color: "var(--ink)", margin: 0 }}>
                Pickups ({otherPickups.length})
              </h3>
              <span style={{ font: "600 10.5px var(--font-body)", color: "rgba(0,0,0,.4)" }}>in route order</span>
            </div>
            {otherPickups.map((p) => (
              <div
                key={p.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 11,
                  background: "var(--surface)",
                  border: "1px solid rgba(0,0,0,.07)",
                  borderRadius: 15,
                  padding: "11px 12px",
                  marginBottom: 8,
                }}
              >
                <span className="av" style={{ background: p.color ?? "var(--teal)" }}>
                  {p.initials ?? p.name.slice(0, 2).toUpperCase()}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ font: "700 13px var(--font-body)", color: "var(--ink)" }}>{p.name}</div>
                  <div style={{ font: "600 11px var(--font-body)", color: "rgba(0,0,0,.5)" }}>
                    📍 {p.pickupLabel ?? "No pickup place set"}
                  </div>
                </div>
              </div>
            ))}
            <div style={{ height: 8 }} />
            {trip.status === "scheduled" && (
              <button className="btnP" disabled={busy} onClick={() => act("start", "Trip started — riders notified 🚗")}>
                Start trip · notify riders
              </button>
            )}
            {trip.status === "started" && (
              <>
                <div
                  style={{
                    background: "var(--teal-soft)",
                    border: "1px solid rgba(20,184,196,.4)",
                    borderRadius: 13,
                    padding: 11,
                    textAlign: "center",
                    font: "700 12px var(--font-body)",
                    color: "var(--teal-ink)",
                    marginBottom: 10,
                  }}
                >
                  ● Trip in progress — riders notified
                </div>
                <button className="btnG" onClick={() => setClosing(true)}>
                  End &amp; close trip
                </button>
              </>
            )}
          </>
        )}

        {!isDriver && trip.role === "open" && trip.joinable && (
          <>
            <div
              style={{
                background: "var(--green-soft)",
                border: "1px solid rgba(23,201,100,.4)",
                borderRadius: 13,
                padding: 12,
                textAlign: "center",
                font: "600 12.5px var(--font-body)",
                color: "var(--green-ink)",
                marginBottom: 12,
              }}
            >
              {trip.seatsLeft} seat{trip.seatsLeft === 1 ? "" : "s"} left — hop in and split the drive.
            </div>
            <button className="btnP" disabled={busy} onClick={() => act("join", "Joined — added to your trips 🎉")}>
              Request to join
            </button>
          </>
        )}

        {!isDriver && trip.role === "open" && !trip.joinable && (
          <div
            style={{
              background: "var(--chip)",
              border: "1px solid rgba(0,0,0,.08)",
              borderRadius: 13,
              padding: 12,
              textAlign: "center",
              font: "600 12.5px var(--font-body)",
              color: "rgba(0,0,0,.5)",
            }}
          >
            This carpool is full.
          </div>
        )}

        {!isDriver && trip.role === "joined" && trip.status !== "closed" && !confirmingLeave && (
          <>
            <div
              style={{
                background: "var(--teal-soft)",
                border: "1px solid rgba(20,184,196,.4)",
                borderRadius: 13,
                padding: 12,
                textAlign: "center",
                font: "600 12.5px var(--font-body)",
                color: "var(--teal-ink)",
                marginBottom: 10,
              }}
            >
              ✓ You&apos;re riding this trip. {trip.driver} will pick you up.
            </div>
            <div
              style={{
                background: "var(--amber-soft)",
                border: "1px solid rgba(255,176,32,.4)",
                borderRadius: 13,
                padding: "11px 12px",
                font: "500 11.5px var(--font-body)",
                lineHeight: 1.45,
                color: "var(--amber-ink)",
                marginBottom: 12,
              }}
            >
              ⚠️ Drop out up to <b>1 hour before departure</b> for free — later cancellations cost points.
            </div>
            <button
              className="btnG"
              style={{ background: "var(--surface)", color: "var(--danger)", border: "1px solid rgba(192,57,43,.3)" }}
              onClick={() => setConfirmingLeave(true)}
            >
              Leave this carpool
            </button>
          </>
        )}

        {!isDriver && trip.role === "joined" && trip.status !== "closed" && confirmingLeave && (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 34 }}>🚪</div>
            <h3 style={{ fontSize: 18, fontWeight: 800, color: "var(--ink)", margin: "12px 0 6px" }}>Leave this carpool?</h3>
            <p style={{ font: "500 12.5px var(--font-body)", lineHeight: 1.5, color: "rgba(0,0,0,.55)", margin: "0 0 20px" }}>
              Your seat opens up for someone else. Dropping within 1 hour of departure costs points.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btnG" style={{ background: "var(--chip)", color: "var(--ink)" }} onClick={() => setConfirmingLeave(false)}>
                Cancel
              </button>
              <button
                className="btnP"
                style={{ background: "var(--danger)", boxShadow: "none" }}
                disabled={busy}
                onClick={() => act("leave", "You left the carpool")}
              >
                Leave
              </button>
            </div>
          </div>
        )}

        {!isDriver && trip.role === "joined" && trip.status === "closed" && (
          <div style={{ textAlign: "center" }}>
            {data.viewerGaveKudos ? (
              <div
                style={{
                  background: "var(--green-soft)",
                  border: "1px solid rgba(23,201,100,.4)",
                  borderRadius: 13,
                  padding: 12,
                  font: "600 12.5px var(--font-body)",
                  color: "var(--green-ink)",
                }}
              >
                💚 Kudos sent to {trip.driver}
              </div>
            ) : (
              <div style={{ background: "var(--surface)", border: "1px solid rgba(0,0,0,.07)", borderRadius: 16, padding: 18, textAlign: "left" }}>
                <h3 style={{ fontSize: 15, fontWeight: 800, color: "var(--ink)", margin: "0 0 4px", textAlign: "center" }}>Rate your ride</h3>
                <p style={{ font: "500 11px var(--font-body)", color: "rgba(0,0,0,.45)", margin: "0 0 14px", textAlign: "center" }}>
                  Say thanks — it boosts {trip.driver}&apos;s score.
                </p>
                <label className="lbl">Comment (optional)</label>
                <textarea
                  className="field"
                  rows={3}
                  placeholder="Great ride, thanks for the coffee!"
                  value={kudosComment}
                  onChange={(e) => setKudosComment(e.target.value)}
                  style={{ resize: "none", fontFamily: "var(--font-body)", marginBottom: 12 }}
                />
                <button className="btnP" disabled={busy} onClick={giveKudos}>
                  Send kudos 💚
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {closing && (
        <CloseTripOverlay
          tripId={tripId}
          riders={otherPickups.map((p) => ({ id: p.id, name: p.name, initials: p.initials, color: p.color }))}
          onClose={() => setClosing(false)}
          onClosed={(message) => {
            setClosing(false);
            onChanged(message);
          }}
        />
      )}
    </div>
  );
}
