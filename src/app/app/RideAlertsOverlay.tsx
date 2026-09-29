"use client";

import { useEffect, useState } from "react";
import { readJsonBody } from "@/lib/http/readJsonBody";
import {
  RIDE_ALERT_DAYS,
  RIDE_ALERT_DAY_LABELS,
  RIDE_ALERT_SLACK_OPTIONS,
  type RideAlertDay,
  type RideAlertDayTimes,
} from "@/domain/rideAlerts";

// D-64. "Tell me when there's a ride at my usual time." Off until the person turns it on. For each
// workday they give the time they usually go to work and the time they usually head home — either
// can be left blank — and how flexible they are. One setting covers all their groups.

interface Settings {
  enabled: boolean;
  slackMinutes: number;
  days: Record<RideAlertDay, RideAlertDayTimes>;
}

const SLACK_LABELS: Record<number, string> = { 15: "15 min", 30: "30 min", 60: "1 hour" };

interface Props {
  onClose: () => void;
  onSaved: (message: string) => void;
}

export function RideAlertsOverlay({ onClose, onSaved }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/me/ride-alerts")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("ride alerts request failed"))))
      .then((body: Settings) => {
        if (!cancelled) setSettings(body);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function setTime(day: RideAlertDay, leg: "out" | "back", value: string) {
    setSettings((s) => (s ? { ...s, days: { ...s.days, [day]: { ...s.days[day], [leg]: value || null } } } : s));
  }

  // The same times every day is the common case, so one tap copies Monday down the week.
  function copyMondayToAll() {
    setSettings((s) => {
      if (!s) return s;
      const days = { ...s.days };
      for (const day of RIDE_ALERT_DAYS) days[day] = { ...s.days.mon };
      return { ...s, days };
    });
  }

  async function save() {
    if (!settings) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/me/ride-alerts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const body = await readJsonBody(res);
      if (!res.ok) {
        setError(body?.message ?? "Couldn't save your alerts.");
        return;
      }
      onSaved(settings.enabled ? "Ride alerts on 🔔" : "Ride alerts off");
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
        <h2 style={{ fontSize: 18, fontWeight: 800, color: "var(--ink)", margin: 0 }}>Ride alerts</h2>
      </div>

      <div className="scroll" style={{ padding: 18 }}>
        {loadFailed && (
          <p style={{ color: "var(--danger)", font: "600 12px var(--font-body)" }}>
            Couldn&apos;t load your alerts. Close this and try again.
          </p>
        )}
        {!settings && !loadFailed && (
          <p style={{ font: "500 12px var(--font-body)", color: "rgba(0,0,0,.45)" }}>Loading…</p>
        )}

        {settings && (
          <>
            <p style={{ font: "500 12px/1.5 var(--font-body)", color: "rgba(0,0,0,.55)", margin: "0 0 14px" }}>
              Get a notification when someone publishes a ride with free seats at the times you usually travel. It
              covers every group you&apos;re in.
            </p>

            <label className="lbl">Alerts</label>
            <div className="seg" style={{ marginBottom: 18 }}>
              <button
                className={`segb ${settings.enabled ? "" : "on"}`}
                onClick={() => setSettings({ ...settings, enabled: false })}
              >
                Off
              </button>
              <button
                className={`segb ${settings.enabled ? "on" : ""}`}
                onClick={() => setSettings({ ...settings, enabled: true })}
              >
                On
              </button>
            </div>

            <div style={{ opacity: settings.enabled ? 1 : 0.45, pointerEvents: settings.enabled ? "auto" : "none" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <label className="lbl">Your usual times</label>
                <button
                  onClick={copyMondayToAll}
                  style={{
                    background: "none",
                    border: "none",
                    font: "700 11px var(--font-body)",
                    color: "var(--purple)",
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  Copy Monday to all
                </button>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "72px 1fr 1fr",
                  gap: "8px 8px",
                  alignItems: "center",
                  marginBottom: 6,
                }}
              >
                <span />
                <span style={{ font: "700 10.5px var(--font-body)", color: "rgba(0,0,0,.45)" }}>To work</span>
                <span style={{ font: "700 10.5px var(--font-body)", color: "rgba(0,0,0,.45)" }}>Back home</span>
                {RIDE_ALERT_DAYS.map((day) => (
                  <DayRow key={day} day={day} times={settings.days[day]} onChange={setTime} />
                ))}
              </div>
              <p style={{ font: "500 11px var(--font-body)", color: "rgba(0,0,0,.4)", margin: "0 2px 18px" }}>
                Leave a time blank to skip it. No alerts on weekends.
              </p>

              <label className="lbl">How flexible are you?</label>
              <div className="seg" style={{ marginBottom: 6 }}>
                {RIDE_ALERT_SLACK_OPTIONS.map((minutes) => (
                  <button
                    key={minutes}
                    className={`segb ${settings.slackMinutes === minutes ? "on" : ""}`}
                    onClick={() => setSettings({ ...settings, slackMinutes: minutes })}
                  >
                    ± {SLACK_LABELS[minutes]}
                  </button>
                ))}
              </div>
              <p style={{ font: "500 11px var(--font-body)", color: "rgba(0,0,0,.4)", margin: "0 2px 18px" }}>
                {exampleLine(settings.slackMinutes)}
              </p>
            </div>

            {error && (
              <p style={{ color: "var(--danger)", font: "600 12px var(--font-body)", margin: "0 0 12px" }}>{error}</p>
            )}
            <button className="btnP" disabled={busy} onClick={save}>
              Save
            </button>
            <button className="btnG" style={{ marginTop: 10 }} onClick={onClose} disabled={busy}>
              Never mind
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function DayRow({
  day,
  times,
  onChange,
}: {
  day: RideAlertDay;
  times: RideAlertDayTimes;
  onChange: (day: RideAlertDay, leg: "out" | "back", value: string) => void;
}) {
  return (
    <>
      <span style={{ font: "700 12.5px var(--font-body)", color: "var(--ink)" }}>{RIDE_ALERT_DAY_LABELS[day].slice(0, 3)}</span>
      <input
        className="field"
        type="time"
        aria-label={`${RIDE_ALERT_DAY_LABELS[day]}, to work`}
        value={times.out ?? ""}
        onChange={(e) => onChange(day, "out", e.target.value)}
        style={{ padding: "8px 10px" }}
      />
      <input
        className="field"
        type="time"
        aria-label={`${RIDE_ALERT_DAY_LABELS[day]}, back home`}
        value={times.back ?? ""}
        onChange={(e) => onChange(day, "back", e.target.value)}
        style={{ padding: "8px 10px" }}
      />
    </>
  );
}

// The worked example the developer used to explain it: a 7:00 ride reaching someone who leaves at 7:30.
function exampleLine(slack: number): string {
  const start = 7 * 60 + 30 - slack;
  const end = 7 * 60 + 30 + slack;
  const fmt = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
  return `If you usually leave at 7:30, rides from ${fmt(start)} to ${fmt(end)} will alert you.`;
}

