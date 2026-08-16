"use client";

import { useMemo, useState } from "react";
import { decorateTrip } from "@/domain/decorateTrip";
import { groupByDay } from "@/domain/tripDay";
import type { TripView } from "@/domain/types";

interface Props {
  trips: TripView[];
  onOpenTrip: (tripId: string) => void;
  onQuickJoin: (tripId: string) => void;
}

export function CarpoolsScreen({ trips, onOpenTrip, onQuickJoin }: Props) {
  const [filter, setFilter] = useState<"all" | "mine">("all");

  const mineCount = useMemo(() => trips.filter((t) => t.role === "driving" || t.role === "joined").length, [trips]);

  const days = useMemo(() => {
    const filtered = filter === "mine" ? trips.filter((t) => t.role === "driving" || t.role === "joined") : trips;
    const decorated = filtered.map(decorateTrip);
    return groupByDay(
      decorated,
      (t) => t.dayLabel,
      (a, b) => a.time.localeCompare(b.time),
    );
  }, [trips, filter]);

  return (
    <>
      <div style={{ padding: "0 20px 6px", flex: "none" }}>
        <div className="seg">
          <button className={`segb ${filter === "all" ? "on" : ""}`} onClick={() => setFilter("all")}>
            All trips
          </button>
          <button className={`segb ${filter === "mine" ? "on" : ""}`} onClick={() => setFilter("mine")}>
            Mine{" "}
            {mineCount > 0 && (
              <span
                style={{
                  background: "var(--purple)",
                  color: "var(--surface)",
                  borderRadius: 8,
                  padding: "1px 6px",
                  fontSize: 9,
                  marginLeft: 3,
                }}
              >
                {mineCount}
              </span>
            )}
          </button>
        </div>
      </div>

      <div className="scroll" style={{ padding: "0 20px 16px" }}>
        {days.length === 0 && (
          <p style={{ textAlign: "center", font: "600 12px var(--font-body)", color: "rgba(0,0,0,.4)", marginTop: 40 }}>
            No trips yet — tap + to offer one.
          </p>
        )}
        {days.map((day) => (
          <div key={day.label}>
            <div className="dayh">{day.label}</div>
            {day.items.map((t) => (
              <div
                key={t.id}
                className="card"
                style={{ borderLeftColor: t.accent, marginBottom: 11 }}
                onClick={() => onOpenTrip(t.id)}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 9 }}>
                  <span className="pill" style={{ color: t.badgeColor, background: t.badgeBg }}>
                    {t.badge}
                  </span>
                  <span style={{ font: "800 14px var(--font-display)", color: "var(--ink)" }}>{t.time}</span>
                </div>
                <div className="route">
                  {t.from} <span style={{ color: "rgba(0,0,0,.3)" }}>→</span> {t.to}
                </div>
                <div style={{ font: "600 12px var(--font-body)", color: "rgba(0,0,0,.5)", marginTop: 4 }}>
                  {t.driverLabel}
                </div>
                <div style={{ display: "flex", gap: 5, alignItems: "center", marginTop: 12 }}>
                  {t.avatars.map((a, i) => (
                    <span
                      key={i}
                      className="av"
                      style={{ background: a.bg, color: a.fg, border: a.dashed ? "1px dashed rgba(0,0,0,.2)" : undefined }}
                    >
                      {a.label}
                    </span>
                  ))}
                  <span style={{ marginLeft: "auto", font: "700 11px var(--font-body)", color: t.seatColor }}>
                    {t.seatStr}
                  </span>
                  {t.joinable && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onQuickJoin(t.id);
                      }}
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 10,
                        background: "var(--green)",
                        color: "var(--surface)",
                        border: "none",
                        fontSize: 19,
                        fontWeight: 700,
                        flex: "none",
                        boxShadow: "0 3px 8px rgba(23,201,100,.35)",
                        lineHeight: 1,
                        cursor: "pointer",
                      }}
                    >
                      +
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}
        <div style={{ height: 8 }} />
      </div>
    </>
  );
}
