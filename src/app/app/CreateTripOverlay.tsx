"use client";

import { useState } from "react";
import { SEATS } from "@/domain/constants";

interface Props {
  groupId: string;
  groupName: string;
  originLabel: string;
  destLabel: string;
  onClose: () => void;
  onCreated: () => void;
}

type Mode = "round" | "one-way";
type Leg = "out" | "back";

export function CreateTripOverlay({ groupId, groupName, originLabel, destLabel, onClose, onCreated }: Props) {
  const [mode, setMode] = useState<Mode>("round");
  const [leg, setLeg] = useState<Leg>("out");
  const [capacity, setCapacity] = useState<number>(SEATS.default);
  const [departTime, setDepartTime] = useState("07:45");
  const [returnTime, setReturnTime] = useState("17:30");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function todayAt(time: string) {
    const [h, m] = time.split(":").map(Number);
    const d = new Date();
    d.setHours(h ?? 0, m ?? 0, 0, 0);
    return d.toISOString();
  }

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const direction = mode === "round" ? "round" : leg;
      const res = await fetch("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupId,
          direction,
          departAt: todayAt(departTime),
          returnAt: mode === "round" ? todayAt(returnTime) : undefined,
          capacity,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.message ?? "Couldn't publish that trip.");
        return;
      }
      onCreated();
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
        <h2 style={{ fontSize: 18, fontWeight: 800, color: "var(--ink)", margin: 0 }}>Offer a trip</h2>
      </div>
      <div className="scroll" style={{ padding: 18 }}>
        <label className="lbl">Direction</label>
        <div className="seg" style={{ marginBottom: 18 }}>
          <button className={`segb ${mode === "round" ? "on" : ""}`} onClick={() => setMode("round")}>
            ↔ Round trip
          </button>
          <button className={`segb ${mode === "one-way" ? "on" : ""}`} onClick={() => setMode("one-way")}>
            → One way
          </button>
        </div>

        <label className="lbl">Route</label>
        {mode === "round" ? (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                background: "var(--purple-soft)",
                border: "1px solid rgba(124,92,255,.3)",
                borderRadius: 13,
                padding: "13px 14px",
                marginBottom: 6,
              }}
            >
              <span style={{ font: "800 15px var(--font-display)", color: "var(--ink)" }}>
                {originLabel} ↔ {destLabel}
              </span>
            </div>
            <p style={{ font: "500 11px var(--font-body)", color: "rgba(0,0,0,.4)", margin: "0 2px 18px" }}>
              Set by your group — every {groupName} trip runs this route.
            </p>
          </>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 6 }}>
              <button
                onClick={() => setLeg("out")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  background: leg === "out" ? "var(--purple-soft)" : "var(--surface)",
                  border: `1.5px solid ${leg === "out" ? "var(--purple)" : "rgba(0,0,0,.1)"}`,
                  borderRadius: 13,
                  padding: "13px 14px",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span style={{ fontSize: 16 }}>🌅</span>
                <div style={{ flex: 1 }}>
                  <div style={{ font: "800 14px var(--font-display)", color: "var(--ink)" }}>
                    {originLabel} → {destLabel}
                  </div>
                  <div style={{ font: "600 10.5px var(--font-body)", color: "rgba(0,0,0,.45)" }}>Morning commute in</div>
                </div>
                <span style={{ fontSize: 15, color: leg === "out" ? "var(--purple)" : "rgba(0,0,0,.1)" }}>
                  {leg === "out" ? "●" : "○"}
                </span>
              </button>
              <button
                onClick={() => setLeg("back")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  background: leg === "back" ? "var(--purple-soft)" : "var(--surface)",
                  border: `1.5px solid ${leg === "back" ? "var(--purple)" : "rgba(0,0,0,.1)"}`,
                  borderRadius: 13,
                  padding: "13px 14px",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span style={{ fontSize: 16 }}>🌇</span>
                <div style={{ flex: 1 }}>
                  <div style={{ font: "800 14px var(--font-display)", color: "var(--ink)" }}>
                    {destLabel} → {originLabel}
                  </div>
                  <div style={{ font: "600 10.5px var(--font-body)", color: "rgba(0,0,0,.45)" }}>Evening commute home</div>
                </div>
                <span style={{ fontSize: 15, color: leg === "back" ? "var(--purple)" : "rgba(0,0,0,.1)" }}>
                  {leg === "back" ? "●" : "○"}
                </span>
              </button>
            </div>
            <p style={{ font: "500 11px var(--font-body)", color: "rgba(0,0,0,.4)", margin: "6px 2px 18px" }}>
              One-way — pick which leg of the group route you&apos;re driving.
            </p>
          </>
        )}

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
            marginBottom: 18,
          }}
        >
          <button
            onClick={() => setCapacity((c) => Math.max(SEATS.min, c - 1))}
            style={{ width: 34, height: 34, borderRadius: 11, border: "none", background: "var(--chip)", fontSize: 20, fontWeight: 700, cursor: "pointer" }}
          >
            −
          </button>
          <div style={{ flex: 1, textAlign: "center", font: "800 20px var(--font-display)", color: "var(--ink)" }}>
            {capacity}
          </div>
          <button
            onClick={() => setCapacity((c) => Math.min(SEATS.max, c + 1))}
            style={{ width: 34, height: 34, borderRadius: 11, border: "none", background: "var(--chip)", fontSize: 20, fontWeight: 700, cursor: "pointer" }}
          >
            +
          </button>
        </div>

        <div style={{ display: "flex", gap: 12, marginBottom: 18 }}>
          <div style={{ flex: 1 }}>
            <label className="lbl">Departs</label>
            <input className="field" type="time" value={departTime} onChange={(e) => setDepartTime(e.target.value)} />
          </div>
          {mode === "round" && (
            <div style={{ flex: 1 }}>
              <label className="lbl">Returns</label>
              <input className="field" type="time" value={returnTime} onChange={(e) => setReturnTime(e.target.value)} />
            </div>
          )}
        </div>

        {error && <p style={{ color: "var(--danger)", font: "600 12px var(--font-body)", margin: "0 0 12px" }}>{error}</p>}
        <button className="btnP" disabled={busy} onClick={submit}>
          Publish to {groupName}
        </button>
      </div>
    </div>
  );
}
