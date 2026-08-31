"use client";

import { useEffect, useState, useCallback } from "react";
import type { DecoratedTrip } from "@/domain/decorateTrip";
import type { TripStopView } from "@/domain/types";
import { NOT_STARTED_REASON } from "@/domain/constants";
import { StopSign } from "./StopSign";
import { rideShareMessage, rideShareUrl } from "@/domain/tripShare";
import { shareOrCopy } from "@/lib/share";
import { CloseTripOverlay } from "./CloseTripOverlay";
import { ReturnQuestionSheet } from "./ReturnQuestionSheet";
import { EditTripOverlay } from "./EditTripOverlay";

interface Pickup {
  id: string;
  name: string;
  initials?: string;
  color?: string;
  pickupLabel: string | null;
  stopOrder: number | null;
  isViewer: boolean;
  // D-24: this seat was booked by the driver, so the driver can take it back.
  addedByDriver: boolean;
}

interface AddableMember {
  id: string;
  name: string;
  initials: string;
  color: string;
}

interface DetailResponse {
  trip: DecoratedTrip;
  driverId: string;
  isDriver: boolean;
  cancelledReason: string | null;
  pickups: Pickup[];
  // Group members not already on this trip — empty unless the viewer is the driver and the trip is
  // still active.
  addableMembers: AddableMember[];
  seatsLeft: number;
  viewerGaveKudos: boolean;
  viewerDeclinedKudos: boolean;
  // D-38: the driver changed this trip after the viewer took their seat, so leaving is free.
  penaltyWaived: boolean;
  // Everything the edit form opens with. Null unless the viewer is the driver and the trip is
  // still scheduled — a started trip's plan is fixed.
  editable: {
    departAt: string;
    returnAt: string | null;
    capacity: number;
    direction: string;
    outStopId: string | null;
    backStopId: string | null;
    stops: TripStopView[];
  } | null;
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
  // D-35: the "coming back too?" question, shown before a join on a round trip.
  const [askingReturn, setAskingReturn] = useState(false);
  const [closing, setClosing] = useState(false);
  const [kudosComment, setKudosComment] = useState("");
  // Sketch default: the toggle starts off, so the submit reads "Skip & close" until the rider opts in.
  const [givingKudos, setGivingKudos] = useState(false);
  const [shareToast, setShareToast] = useState<string | null>(null);
  const [addingPassenger, setAddingPassenger] = useState(false);
  // D-38: the driver's two ways out of a plan that stopped working.
  const [editing, setEditing] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

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

  // Returns whether the action actually went through, so a confirmation sheet can stay open —
  // showing its error — instead of closing over a failure the driver never saw.
  async function act(path: string, message: string, payload?: unknown): Promise<boolean> {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/trips/${tripId}/${path}`, {
        method: "POST",
        ...(payload === undefined
          ? {}
          : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.message ?? "That didn't work.");
        return false;
      }
      setConfirmingLeave(false);
      await load();
      onChanged(message);
      return true;
    } catch {
      setError("Couldn't reach the server — check your connection and try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  // One submit for both halves of the sketch's rate overlay: give kudos, or close the prompt without
  // giving any (D-18). Declining is recorded server-side so it stays cleared on every device.
  async function submitRating() {
    setError(null);
    setBusy(true);
    try {
      const res = givingKudos
        ? await fetch(`/api/trips/${tripId}/kudos`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ comment: kudosComment.trim() || undefined }),
          })
        : await fetch(`/api/trips/${tripId}/kudos/decline`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setError(body.message ?? (givingKudos ? "Couldn't send kudos." : "Couldn't close the prompt."));
        return;
      }
      await load();
      onChanged(givingKudos ? "Kudos sent 💚" : "Ride closed");
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

  const { trip, isDriver, pickups, addableMembers, seatsLeft, penaltyWaived, editable } = data;
  const otherPickups = pickups.filter((p) => !p.isViewer);
  // Only a ride someone could still act on is worth sharing — a closed or cancelled one would send
  // the recipient to a dead end.
  const shareable = trip.status === "scheduled" || trip.status === "started";
  const isLive = trip.status === "scheduled" || trip.status === "started";
  const isCancelled = trip.status === "cancelled";
  // D-23: the scheduler ending a trip nobody started is not the driver calling it off, and must
  // never be worded as if it were.
  const neverStarted = isCancelled && data.cancelledReason === NOT_STARTED_REASON;

  // The arrow rising out of an open tray — the same glyph every phone uses for "send this
  // elsewhere", so the button reads as shareable before anyone parses the label.
  const shareArrow = (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 15V3" />
      <path d="M8 7l4-4 4 4" />
      <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  );

  // D-24: only the driver reaches these two. The seat counts against capacity like any other, and
  // the person is notified either way — being moved on and off someone's trip silently would be
  // the worst version of this feature.
  async function addPassenger(profileId: string, name: string) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/trips/${tripId}/riders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.message ?? "Couldn't add that passenger.");
        return;
      }
      setAddingPassenger(false);
      await load();
      onChanged(`${name} added to this ride`);
    } catch {
      setError("Couldn't reach the server — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function removePassenger(riderId: string, name: string) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/trips/${tripId}/riders/${riderId}`, { method: "DELETE" });
      const body = await res.json();
      if (!res.ok) {
        setError(body.message ?? "Couldn't remove that passenger.");
        return;
      }
      await load();
      onChanged(`${name} removed from this ride`);
    } catch {
      setError("Couldn't reach the server — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function shareRide() {
    // The link itself reveals nothing (D-20): /t/:id is gated on being signed in and in the group.
    const { title, text } = rideShareMessage(trip);
    const outcome = await shareOrCopy({ title, text, url: rideShareUrl(window.location.origin, tripId) });
    if (outcome === "shared") return;
    setShareToast(outcome === "copied" ? "Ride link copied 🔗" : "Couldn't copy — copy it manually");
    setTimeout(() => setShareToast(null), 2200);
  }

  // Sits directly above whichever action the viewer came here to take, so it can't be missed.
  const shareButton = shareable ? (
    <button className="btnShare" onClick={shareRide}>
      {shareArrow}
      Share this ride
    </button>
  ) : null;

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

        {trip.stopNotices.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 11 }}>
            {trip.stopNotices.map((n) => (
              <StopRow key={n.leg} leg={n.when} stop={n.stop} />
            ))}
          </div>
        )}

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

        {isCancelled && (
          <div
            style={{
              background: neverStarted ? "var(--chip)" : "rgba(192,57,43,.07)",
              border: `1px solid ${neverStarted ? "rgba(0,0,0,.08)" : "rgba(192,57,43,.25)"}`,
              borderRadius: 15,
              padding: 13,
              marginBottom: 16,
            }}
          >
            <div style={{ font: "800 13.5px var(--font-display)", color: neverStarted ? "rgba(0,0,0,.6)" : "var(--danger)" }}>
              {neverStarted ? "This ride never ran" : "This trip was cancelled"}
            </div>
            <div style={{ font: "500 11.5px/1.5 var(--font-body)", color: "rgba(0,0,0,.5)", marginTop: 4 }}>
              {neverStarted
                ? "Nobody started it within a day of departure, so it was filed away. No points were awarded and nobody was charged."
                : data.cancelledReason
                  ? `${isDriver ? "You called it off" : `${trip.driver} called it off`}: “${data.cancelledReason}”. Nobody lost points.`
                  : `${isDriver ? "You called it off" : `${trip.driver} called it off`}. Nobody lost points.`}
            </div>
          </div>
        )}

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
                    {p.addedByDriver ? "Added by you" : `📍 ${p.pickupLabel ?? "No pickup place set"}`}
                  </div>
                </div>
                {p.addedByDriver && trip.status !== "closed" && trip.status !== "cancelled" && (
                  <button
                    onClick={() => removePassenger(p.id, p.name)}
                    disabled={busy}
                    aria-label={`Remove ${p.name}`}
                    style={{
                      background: "none",
                      border: "none",
                      color: "rgba(0,0,0,.35)",
                      font: "700 11px var(--font-body)",
                      cursor: "pointer",
                      padding: 4,
                      flex: "none",
                    }}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}

            {(trip.status === "scheduled" || trip.status === "started") && (
              <button
                onClick={() => setAddingPassenger(true)}
                disabled={busy || seatsLeft <= 0 || addableMembers.length === 0}
                style={{
                  width: "100%",
                  background: "var(--purple-soft)",
                  border: "1px dashed rgba(124,92,255,.5)",
                  borderRadius: 15,
                  padding: "11px 12px",
                  font: "700 12.5px var(--font-body)",
                  color: "var(--purple)",
                  cursor: seatsLeft > 0 && addableMembers.length > 0 ? "pointer" : "not-allowed",
                  opacity: seatsLeft > 0 && addableMembers.length > 0 ? 1 : 0.55,
                  marginBottom: 8,
                }}
              >
                {seatsLeft <= 0
                  ? "No seats left to add anyone"
                  : addableMembers.length === 0
                    ? "Everyone in the group is already on this ride"
                    : "+ Add a passenger"}
              </button>
            )}
            <div style={{ height: 8 }} />
            {trip.status === "scheduled" && (
              <>
                {shareButton}
                <button className="btnP" disabled={busy} onClick={() => act("start", "Trip started — riders notified 🚗")}>
                  Start trip · notify riders
                </button>
                {/* D-38: plans change. Both ways out sit under the primary action, secondary in
                    weight — the common case is still starting the ride you published. */}
                <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                  <button
                    className="btnG"
                    disabled={busy || !editable}
                    onClick={() => setEditing(true)}
                    style={{ flex: 1 }}
                  >
                    Edit trip
                  </button>
                  <button
                    className="btnG"
                    disabled={busy}
                    onClick={() => setConfirmingCancel(true)}
                    style={{ flex: 1, background: "var(--surface)", color: "var(--danger)", border: "1px solid rgba(192,57,43,.3)" }}
                  >
                    Cancel trip
                  </button>
                </div>
              </>
            )}
            {trip.status === "started" && (
              <>
                {shareButton}
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
            {shareButton}
            <button
              className="btnP"
              disabled={busy}
              onClick={() => {
                // D-35 answer (C): a round trip asks the return question first, with no default.
                if (trip.direction === "round") {
                  setAskingReturn(true);
                  return;
                }
                void act("join", "Joined — added to your trips 🎉", { wantsReturn: false });
              }}
            >
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

        {!isDriver && trip.role === "joined" && isLive && !confirmingLeave && (
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
            {penaltyWaived ? (
              // D-38. The driver moved this trip after the seat was taken, so the usual warning
              // would be a lie — and this is the moment the rider most needs to know they are free
              // to go, not a moment to be threatened with a penalty.
              <div
                style={{
                  background: "var(--green-soft)",
                  border: "1px solid rgba(23,201,100,.4)",
                  borderRadius: 13,
                  padding: "11px 12px",
                  font: "500 11.5px var(--font-body)",
                  lineHeight: 1.45,
                  color: "var(--green-ink)",
                  marginBottom: 12,
                }}
              >
                🔄 <b>{trip.driver} changed this trip</b> after you joined. If the new plan doesn&apos;t work, leave
                any time with <b>no points lost</b>.
              </div>
            ) : (
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
            )}
            {shareButton}
            <button
              className="btnG"
              style={{ background: "var(--surface)", color: "var(--danger)", border: "1px solid rgba(192,57,43,.3)" }}
              onClick={() => setConfirmingLeave(true)}
            >
              Leave this carpool
            </button>
          </>
        )}

        {!isDriver && trip.role === "joined" && isLive && confirmingLeave && (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 34 }}>🚪</div>
            <h3 style={{ fontSize: 18, fontWeight: 800, color: "var(--ink)", margin: "12px 0 6px" }}>Leave this carpool?</h3>
            <p style={{ font: "500 12.5px var(--font-body)", lineHeight: 1.5, color: "rgba(0,0,0,.55)", margin: "0 0 20px" }}>
              {penaltyWaived
                ? "Your seat opens up for someone else. This trip changed after you joined, so leaving costs you nothing."
                : "Your seat opens up for someone else. Dropping within 1 hour of departure costs points."}
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
            ) : data.viewerDeclinedKudos ? (
              <div
                style={{
                  background: "var(--chip)",
                  border: "1px solid rgba(0,0,0,.08)",
                  borderRadius: 13,
                  padding: 12,
                  font: "600 12.5px var(--font-body)",
                  color: "rgba(0,0,0,.5)",
                }}
              >
                Ride closed — no kudos given.
              </div>
            ) : (
              <div style={{ background: "var(--surface)", border: "1px solid rgba(0,0,0,.07)", borderRadius: 16, padding: 18, textAlign: "left" }}>
                <h3 style={{ fontSize: 15, fontWeight: 800, color: "var(--ink)", margin: "0 0 4px", textAlign: "center" }}>Rate your ride</h3>
                <p style={{ font: "500 11px var(--font-body)", color: "rgba(0,0,0,.45)", margin: "0 0 14px", textAlign: "center" }}>
                  Say thanks — it boosts {trip.driver}&apos;s score.
                </p>

                <button
                  onClick={() => setGivingKudos((on) => !on)}
                  aria-pressed={givingKudos}
                  style={{
                    width: "100%",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 5,
                    background: givingKudos ? "var(--green-soft)" : "var(--bg)",
                    border: `1.5px solid ${givingKudos ? "rgba(23,201,100,.6)" : "rgba(0,0,0,.12)"}`,
                    borderRadius: 16,
                    padding: 20,
                    cursor: "pointer",
                    marginBottom: 18,
                  }}
                >
                  <div style={{ fontSize: 38 }}>💚</div>
                  <div style={{ font: "800 15px var(--font-display)", color: givingKudos ? "var(--green-ink)" : "rgba(0,0,0,.6)" }}>
                    {givingKudos ? "Kudos given ✓" : "Give kudos"}
                  </div>
                  <div style={{ font: "500 11px var(--font-body)", color: "rgba(0,0,0,.45)" }}>
                    One kudos per ride — you give it or you don&apos;t
                  </div>
                </button>

                <label className="lbl">Comment (optional)</label>
                <textarea
                  className="field"
                  rows={3}
                  placeholder="Great ride, thanks for the coffee!"
                  value={kudosComment}
                  onChange={(e) => setKudosComment(e.target.value)}
                  style={{ resize: "none", fontFamily: "var(--font-body)", marginBottom: 12 }}
                />
                <button className="btnP" disabled={busy} onClick={submitRating}>
                  {givingKudos ? "Send kudos 💚" : "Skip & close"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {askingReturn && (
        <ReturnQuestionSheet
          time={trip.time}
          returnTime={trip.returnTime}
          driver={trip.driver}
          onAnswer={(wantsReturn) => {
            setAskingReturn(false);
            void act(
              "join",
              wantsReturn ? "Joined both ways — seat home held 🎉" : "Joined — added to your trips 🎉",
              { wantsReturn },
            );
          }}
          onClose={() => setAskingReturn(false)}
        />
      )}

      {editing && editable && (
        <EditTripOverlay
          tripId={tripId}
          direction={editable.direction}
          departAt={editable.departAt}
          returnAt={editable.returnAt}
          capacity={editable.capacity}
          outStopId={editable.outStopId}
          backStopId={editable.backStopId}
          stops={editable.stops}
          seatedCount={otherPickups.length}
          onClose={() => setEditing(false)}
          onSaved={(message) => {
            setEditing(false);
            void load();
            onChanged(message);
          }}
        />
      )}

      {confirmingCancel && (
        <div className="sheet" onClick={() => setConfirmingCancel(false)}>
          <div className="sheetc" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ font: "800 17px var(--font-display)", color: "var(--ink)", margin: "0 0 2px" }}>
              Cancel this trip?
            </h3>
            <p style={{ font: "500 11.5px/1.5 var(--font-body)", color: "rgba(0,0,0,.5)", margin: "0 0 14px" }}>
              {otherPickups.length === 0
                ? "Nobody has joined, so this just disappears from the feed. It can't be undone — you'd publish a new trip instead."
                : `${otherPickups.length === 1 ? "1 rider is" : `${otherPickups.length} riders are`} counting on this ride. They'll be notified straight away and lose no points. This can't be undone.`}
            </p>

            <label className="lbl">Why? (optional)</label>
            <textarea
              className="field"
              rows={2}
              maxLength={200}
              placeholder="Car's in the shop — sorry!"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              style={{ resize: "none", fontFamily: "var(--font-body)", marginBottom: 4 }}
            />
            <p style={{ font: "500 10.5px var(--font-body)", color: "rgba(0,0,0,.4)", margin: "0 2px 14px" }}>
              Riders see this in their notification — a line here saves five messages later.
            </p>

            {error && <p style={{ color: "var(--danger)", font: "600 12px var(--font-body)", margin: "0 0 10px" }}>{error}</p>}
            <div style={{ display: "flex", gap: 10 }}>
              <button
                className="btnG"
                style={{ background: "var(--chip)", color: "var(--ink)" }}
                disabled={busy}
                onClick={() => setConfirmingCancel(false)}
              >
                Keep it
              </button>
              <button
                className="btnP"
                style={{ background: "var(--danger)", boxShadow: "none" }}
                disabled={busy}
                onClick={async () => {
                  const reason = cancelReason.trim();
                  const done = await act(
                    "cancel",
                    otherPickups.length > 0 ? "Trip cancelled — riders notified" : "Trip cancelled",
                    reason ? { reason } : {},
                  );
                  if (done) setConfirmingCancel(false);
                }}
              >
                Cancel trip
              </button>
            </div>
          </div>
        </div>
      )}

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

      {addingPassenger && (
        <div className="sheet" onClick={() => setAddingPassenger(false)}>
          <div className="sheetc" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ font: "800 17px var(--font-display)", color: "var(--ink)", margin: "0 0 2px" }}>
              Add a passenger
            </h3>
            <p style={{ font: "500 11.5px var(--font-body)", color: "rgba(0,0,0,.5)", margin: "0 0 14px" }}>
              {seatsLeft} seat{seatsLeft === 1 ? "" : "s"} left. They&apos;ll be notified, and they can leave without
              losing points.
            </p>
            <div style={{ maxHeight: 280, overflowY: "auto" }}>
              {addableMembers.map((m) => (
                <button
                  key={m.id}
                  disabled={busy}
                  onClick={() => addPassenger(m.id, m.name)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 11,
                    width: "100%",
                    background: "var(--surface)",
                    border: "1px solid rgba(0,0,0,.07)",
                    borderRadius: 15,
                    padding: "11px 12px",
                    marginBottom: 8,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span className="av" style={{ background: m.color }}>
                    {m.initials}
                  </span>
                  <span style={{ flex: 1, font: "700 13px var(--font-body)", color: "var(--ink)" }}>{m.name}</span>
                  <span style={{ color: "var(--purple)", font: "800 13px var(--font-body)" }}>+</span>
                </button>
              ))}
            </div>
            {error && <p style={{ color: "var(--danger)", font: "600 12px var(--font-body)", margin: "8px 2px 0" }}>{error}</p>}
            <button className="btnG" style={{ marginTop: 10 }} onClick={() => setAddingPassenger(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {shareToast && <div className="toast" style={{ position: "fixed" }}>{shareToast}</div>}
    </div>
  );
}

// D-29. The card shows the sign; the detail screen is where the address earns its place — a rider
// deciding whether to take the ride wants to know *which* gym.
function StopRow({ leg, stop }: { leg: string; stop: TripStopView }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <StopSign stop={stop} />
      <div style={{ minWidth: 0 }}>
        <div style={{ font: "700 10px var(--font-body)", color: "rgba(0,0,0,.4)", textTransform: "uppercase" }}>{leg}</div>
        <div style={{ font: "600 12px var(--font-body)", color: "rgba(0,0,0,.55)" }}>{stop.address}</div>
      </div>
    </div>
  );
}
