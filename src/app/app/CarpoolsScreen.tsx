"use client";

import { useMemo, useState } from "react";
import { decorateTrip, type DecoratedTrip } from "@/domain/decorateTrip";
import { groupByDay } from "@/domain/tripDay";
import type { TripView } from "@/domain/types";
import { StopMention } from "./StopSign";

interface Props {
  trips: TripView[];
  onOpenTrip: (tripId: string) => void;
  onQuickJoin: (tripId: string) => void;
}

// One card, used in all three sections (D-27). A finished trip renders the same
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
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div className="route" style={{ minWidth: 0 }}>
          {trip.from} <span style={{ color: "rgba(0,0,0,.3)" }}>→</span> {trip.to}
        </div>
        <StopMention notices={trip.stopNotices} />
      </div>
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

// The feed's three section headings share one look, one step louder than the day headings
// ("TODAY · MON 21") that sit inside "Available trips".
const SECTION_TITLE_STYLE = {
  font: "800 15px var(--font-display)",
  color: "var(--ink)",
  margin: "14px 0 8px",
} as const;

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 style={SECTION_TITLE_STYLE}>{children}</h3>;
}

// A section that folds. `aria-expanded` is what the e2e helpers read to open one without closing it.
function FoldingSection({
  label,
  open,
  onToggle,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        aria-expanded={open}
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
        <span style={SECTION_TITLE_STYLE}>{label}</span>
        <span style={{ color: "rgba(0,0,0,.35)", fontSize: 12, marginTop: 6 }}>{open ? "▾" : "▸"}</span>
      </button>
      {open && children}
    </div>
  );
}

export function CarpoolsScreen({ trips, onOpenTrip, onQuickJoin }: Props) {
  const [filter, setFilter] = useState<"all" | "mine">("all");
  // D-53: hidden, not deleted. The developer's complaint was a month of finished rides sitting
  // under today's, so the section starts shut — one tap still opens it, and the kudos prompt D-27
  // put on those cards is still reachable behind it.
  const [pastOpen, setPastOpen] = useState(false);
  // Today's finished rides start OPEN: someone who just got out of the car is the person most likely
  // to be looking for that ride (kudos, the driver's fix-the-list), and it is at most a day's worth.
  const [completedOpen, setCompletedOpen] = useState(true);

  const mineCount = useMemo(() => trips.filter((t) => t.role === "driving" || t.role === "joined").length, [trips]);

  const { days, completedToday, past } = useMemo(() => {
    const filtered = filter === "mine" ? trips.filter((t) => t.role === "driving" || t.role === "joined") : trips;
    const decorated = filtered.map(decorateTrip);
    return {
      days: groupByDay(
        decorated.filter((t) => t.section === "available"),
        (t) => t.dayLabel,
        // By instant. Sorting the rendered strings put "7:45" after "17:30".
        (a, b) => new Date(a.departAt).getTime() - new Date(b.departAt).getTime(),
      ),
      // The feed arrives ordered by departure ascending, so reversing puts the most recent finished
      // trip at the top of each finished section — which is the one someone is looking for.
      completedToday: decorated.filter((t) => t.section === "completedToday").reverse(),
      past: decorated.filter((t) => t.section === "past").reverse(),
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
        {/* Three sections (developer, 2026-09-21): "There is past, there is completed (today) and
            available trips." */}
        <SectionTitle>Available trips</SectionTitle>
        {days.length === 0 && (
          <p style={{ textAlign: "center", font: "600 12px var(--font-body)", color: "rgba(0,0,0,.4)", margin: "18px 0 22px" }}>
            No trips available
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

        {/* Rides that finished today. Not "Past": a ride settles the moment it departs, so someone
            still in the car would otherwise find their own ride filed under "Past". */}
        {completedToday.length > 0 && (
          <FoldingSection
            label={`Completed today · ${completedToday.length}`}
            open={completedOpen}
            onToggle={() => setCompletedOpen((open) => !open)}
          >
            {completedToday.map((t) => (
              <TripCard key={t.id} trip={t} onOpen={onOpenTrip} onQuickJoin={onQuickJoin} />
            ))}
          </FoldingSection>
        )}

        {/* D-53: everything older — and every cancelled ride — hidden, not deleted, behind a
            section that starts shut. */}
        {past.length > 0 && (
          <FoldingSection label={`Past · ${past.length}`} open={pastOpen} onToggle={() => setPastOpen((open) => !open)}>
            {past.map((t) => (
              <TripCard key={t.id} trip={t} onOpen={onOpenTrip} onQuickJoin={onQuickJoin} />
            ))}
          </FoldingSection>
        )}
        <div style={{ height: 8 }} />
      </div>
    </>
  );
}
