import type { StopNotice } from "@/domain/decorateTrip";
import type { StopIcon, TripStopView } from "@/domain/types";

// D-29. The sign a stop shows on a trip card. Drawn rather than typed: an emoji renders differently
// on every phone, and this is a PWA people install, so the same trip would look different to
// different colleagues in the same group.

const GLYPHS: Record<StopIcon, string[]> = {
  gym: ["M4 9v6", "M7 6v12", "M17 6v12", "M20 9v6", "M7 12h10"],
  pool: ["M3 17c1.5 0 1.5 1.6 3 1.6s1.5-1.6 3-1.6 1.5 1.6 3 1.6 1.5-1.6 3-1.6 1.5 1.6 3 1.6", "M7 14V7a2 2 0 0 1 4 0v7", "M15 14V7a2 2 0 0 1 4 0v7"],
  run: ["M9 21l3-6-3-3 1-5", "M6 12l4-3 4 3 3 1", "M10 7h4"],
  sport: ["M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z", "M12 8l3.5 2.5-1.3 4h-4.4l-1.3-4z"],
  shop: ["M6 8h12l-1 12H7z", "M9 8V6a3 3 0 0 1 6 0v2"],
  coffee: ["M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z", "M17 9h2a2 2 0 0 1 0 5h-2", "M8 3v2", "M12 3v2"],
  school: ["M12 5l10 5-10 5-10-5z", "M6 12v5c0 1.6 3 3 6 3s6-1.4 6-3v-5"],
  medical: ["M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z"],
};

// Narrows the bare string a pickup_place row carries. The CHECK constraint guarantees the value;
// the generated DB types don't, and a blank sign is worse than no sign.
export function isStopIcon(value: string | null): value is StopIcon {
  return value !== null && value in GLYPHS;
}

export function StopGlyph({ icon, size = 15 }: { icon: StopIcon; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flex: "none" }}
    >
      {GLYPHS[icon].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

// Amber deliberately: purple and teal already mean "you're driving" and "you've joined", and a sign
// that borrowed either would weaken the badge telling you your own relationship to the trip.
export function StopSign({ stop, small = false }: { stop: TripStopView; small?: boolean }) {
  return (
    <span
      title={stop.address}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        background: "var(--amber-soft)",
        color: "var(--amber-ink)",
        padding: small ? "2px 8px" : "3px 9px",
        borderRadius: 20,
        font: `700 ${small ? 11 : 12}px var(--font-body)`,
        whiteSpace: "nowrap",
      }}
    >
      <StopGlyph icon={stop.icon} size={small ? 13 : 15} />
      {stop.label}
    </span>
  );
}

// What the car does before it arrives. No box, no border, no alert glyph — a bordered block read
// as "something is wrong with this ride", and nothing is. The tinted chip carries the name, the
// trailing text carries the timing.
//
// It sits at the right end of the route row, opposite the origin -> destination it qualifies, so
// the card keeps one horizontal band per fact instead of growing a row. Two stops stack rather
// than run on, which keeps the right edge readable when a round trip stops on both legs.
export function StopMention({ notices }: { notices: StopNotice[] }) {
  if (notices.length === 0) return null;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 7,
        marginLeft: "auto",
        paddingLeft: 8,
        flex: "none",
      }}
    >
      {notices.map((n) => (
        // The place carries the meaning, so it gets the size; the leg is a qualifier and stays
        // quiet underneath it.
        <span key={n.leg} style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
          <span
            title={n.stop.address}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              background: "var(--amber-soft)",
              color: "var(--amber-ink)",
              padding: "2px 9px",
              borderRadius: 20,
              font: "700 13px var(--font-body)",
              whiteSpace: "nowrap",
            }}
          >
            <StopGlyph icon={n.stop.icon} size={15} />
            {n.stop.label}
          </span>
          <span style={{ font: "600 10.5px var(--font-body)", color: "rgba(0,0,0,.45)", lineHeight: 1.2 }}>
            {n.when}
          </span>
        </span>
      ))}
    </div>
  );
}

// D-29. A dropdown over the group's own list — the driver never types a place, so a group has
// exactly one spelling of "Gym" and the sign always matches the admin's wording.
export function StopPicker({
  label,
  stops,
  value,
  onChange,
}: {
  label: string;
  stops: TripStopView[];
  value: string;
  onChange: (v: string) => void;
}) {
  const selected = stops.find((s) => s.id === value) ?? null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ font: "600 12px var(--font-body)", color: "rgba(0,0,0,.5)", minWidth: 92 }}>{label}</span>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 30,
          height: 30,
          borderRadius: 10,
          flex: "none",
          background: selected ? "var(--amber-soft)" : "var(--chip)",
          color: selected ? "var(--amber-ink)" : "rgba(0,0,0,.25)",
        }}
      >
        {selected ? <StopGlyph icon={selected.icon} size={16} /> : "–"}
      </span>
      <select className="field" style={{ flex: 1 }} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        <option value="">No stop</option>
        {stops.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
  );
}
