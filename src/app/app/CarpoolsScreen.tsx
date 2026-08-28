"use client";

import { useMemo, useState } from "react";
import { decorateTrip, type DecoratedTrip } from "@/domain/decorateTrip";
import { groupByDay } from "@/domain/tripDay";
import type { TripView } from "@/domain/types";
import { RouteLine } from "./StopSign";

interface Props {
  trips: TripView[];
  onOpenTrip: (tripId: string) => void;
  onQuickJoin: (tripId: string) => void;
}

// One card, used by both the live feed and the Past section (D-27). A past trip renders the same
// way minus the quick-join button, which decorateTrip has already turned off — a finished ride
// can't be joined, and neither can one that has already left.
function TripCard({
  trip,
  onOpen,
  onQuickJoin,
}: {
  trip: DecoratedTrip;
  onOpen: (id: string) => void;
  onQuickJoin: (id: string) => void;
}) {
  return (
    <div
      className="card"
      style={{ borderLeftColor: trip.accent, marginBottom: 11, opacity: trip.isPast ? 0.72 : 1 }}
      onClick={() => onOpen(trip.id)}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 9 }}>
        <span className="pill" style={{ color: trip.badgeColor, background: trip.badgeBg }}>
          {trip.badge}
        </span>
        <span style={{ font: "800 14px var(--font-display)", color: "var(--ink)" }}>{trip.time}</span>
      </div>
      <RouteLine leg={trip.route} />
      {trip.returnRoute && <RouteLine leg={trip.returnRoute} muted />}
      <div style={{ font: "600 12px var(--font-body)", color: "rgba(0,0,0,.5)", marginTop: 4 }}>{trip.driverLabel}</div>
      <div style={{ display: "flex", gap: 5, alignItems: "center", marginTop: 12 }}>
        {trip.avatars.map((a, i) => (
          <span
            key={i}
            className="av"
            style={{ background: a.bg, color: a.fg, border: a.dashed ? "1px dashed rgba(0,0,0,.2)" : undefined }}
          >
            {a.label}
          </span>
        ))}
        <span style={{ marginLeft: "auto", font: "700 11px var(--font-body)", color: trip.seatColor }}>
          {trip.seatStr}
        </span>
        {trip.joinable && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onQuickJoin(trip.id);
            }}
            aria-label="Join this trip"
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
  );
}

export function CarpoolsScreen({ trips, onOpenTrip, onQuickJoin }: Props) {
  const [filter, setFilter] = useState<"all" | "mine">("all");
  const [pastOpen, setPastOpen] = useState(true);

  const mineCount = useMemo(() => trips.filter((t) => t.role === "driving" || t.role === "joined").length, [trips]);

  const { days, past } = useMemo(() => {
    const filtered = filter === "mine" ? trips.filter((t) => t.role === "driving" || t.role === "joined") : trips;
    const decorated = filtered.map(decorateTrip);
    return {
      days: groupByDay(
        decorated.filter((t) => !t.isPast),
        (t) => t.dayLabel,
        (a, b) => a.time.localeCompare(b.time),
      ),
      // The feed arrives ordered by departure ascending, so reversing puts the most recent finished
      // trip at the top of the Past section — which is the one someone is looking for.
      past: decorated.filter((t) => t.isPast).reverse(),
    };
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
        {days.length === 0 && past.length === 0 && (
          <p style={{ textAlign: "center", font: "600 12px var(--font-body)", color: "rgba(0,0,0,.4)", marginTop: 40 }}>
            No trips yet — tap + to offer one.
          </p>
        )}
        {days.length === 0 && past.length > 0 && (
          <p style={{ textAlign: "center", font: "600 12px var(--font-body)", color: "rgba(0,0,0,.4)", margin: "24px 0 18px" }}>
            Nothing coming up — tap + to offer a ride.
          </p>
        )}
        {days.map((day) => (
          <div key={day.label}>
            <div className="dayh">{day.label}</div>
            {day.items.map((t) => (
              <TripCard key={t.id} trip={t} onOpen={onOpenTrip} onQuickJoin={onQuickJoin} />
            ))}
          </div>
        ))}

        {past.length > 0 && (
          <div>
            <button
              onClick={() => setPastOpen((open) => !open)}
              aria-expanded={pastOpen}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                width: "100%",
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <span className="dayh" style={{ marginBottom: 0 }}>
                Past · {past.length}
              </span>
              <span style={{ color: "rgba(0,0,0,.3)", fontSize: 12, marginTop: 2 }}>{pastOpen ? "▾" : "▸"}</span>
            </button>
            <div style={{ height: 10 }} />
            {pastOpen &&
              past.map((t) => <TripCard key={t.id} trip={t} onOpen={onOpenTrip} onQuickJoin={onQuickJoin} />)}
          </div>
        )}
        <div style={{ height: 8 }} />
      </div>
    </>
  );
}
