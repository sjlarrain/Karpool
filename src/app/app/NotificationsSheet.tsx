"use client";

import { relativeTime } from "@/domain/relativeTime";
import type { Database } from "@/types/database";

// The bell's bottom sheet (sketch: "NOTIFICATIONS (from bell)"). Rows are tinted by type, carry an
// icon tile, and a `rate` row is the only actionable one in the sketch — here any row that carries a
// tripId opens that trip (a chat row opens its chat), and a row with a `url` opens that link.

export type NotificationItem = {
  id: string;
  // Taken from the database row rather than restated here. AppShell casts the fetched JSON into
  // this shape, so a hand-written union would let a new notification type reach the sheet with no
  // icon and no tint and nothing to warn anyone — a migration adding a type now breaks the maps
  // below at compile time instead.
  type: Database["public"]["Tables"]["notification"]["Row"]["type"];
  title: string;
  body: string | null;
  tripId: string | null;
  // D-61: set when the row points somewhere outside the app — today only D-54's parking link.
  url: string | null;
  read: boolean;
  createdAt: string;
};

// Sketch's type -> icon/tint maps. "reminder" post-dates the sketch (migration 0003) and reuses the
// change tint, since both are "something about the schedule needs your attention"; so does D-61's
// "parking", which is the same kind of nudge. `start` and `close_reminder` are no longer written by
// anything (D-61 removed both taps), but old rows still render.
const ICON: Record<NotificationItem["type"], string> = {
  start: "🚗",
  rate: "💚",
  change: "⏰",
  comment: "💬",
  tip: "💡",
  reminder: "⏱️",
  close_reminder: "✅",
  parking: "🅿️",
  join: "🙋",
  leave: "👋",
};

const CARD_BG: Record<NotificationItem["type"], string> = {
  start: "var(--teal-soft)",
  rate: "var(--notif-rate-bg)",
  change: "var(--amber-soft)",
  comment: "var(--surface)",
  tip: "var(--notif-tip-bg)",
  reminder: "var(--amber-soft)",
  close_reminder: "var(--amber-soft)",
  parking: "var(--amber-soft)",
  join: "var(--green-soft)",
  leave: "var(--amber-soft)",
};

const ICON_BG: Record<NotificationItem["type"], string> = {
  start: "var(--teal-soft)",
  rate: "var(--notif-rate-icon)",
  change: "var(--notif-change-icon)",
  comment: "var(--purple-soft)",
  tip: "var(--notif-tip-icon)",
  reminder: "var(--notif-change-icon)",
  close_reminder: "var(--notif-change-icon)",
  parking: "var(--notif-change-icon)",
  join: "var(--green-soft)",
  leave: "var(--notif-change-icon)",
};

const CTA: Partial<Record<NotificationItem["type"], string>> = {
  rate: "Rate ride",
  start: "View trip",
  change: "View trip",
  reminder: "View trip",
  // Old rows only (D-61 retired the nudge and the End button with it) — so they just open the ride.
  close_reminder: "View trip",
  // D-61: this one leaves the app — it opens the group's parking page (D-54).
  parking: "Pay parking",
  // D-57: a chat message is only useful if you can get to the thread it was said in.
  comment: "Open chat",
  join: "View trip",
  leave: "View trip",
};

type Props = {
  notifications: NotificationItem[];
  loading: boolean;
  onClose: () => void;
  // `chat: true` opens the ride straight into its chat — a chat row's button says "Open chat", and
  // landing on the ride instead left the reader one more tap from the message they were sent.
  onOpenTrip: (tripId: string, opts?: { chat?: boolean }) => void;
};

export function NotificationsSheet({ notifications, loading, onClose, onOpenTrip }: Props) {
  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheetc" onClick={(e) => e.stopPropagation()}>
        {/* Pinned while the list scrolls under it (the sheet scrolls itself once it is full). The
            negative margins pull it over the sheet's own padding so rows never show above it. */}
        <div
          style={{
            position: "sticky",
            top: -20,
            zIndex: 1,
            background: "var(--bg)",
            margin: "-20px -20px 0",
            padding: "20px 20px 12px",
          }}
        >
          <div style={{ width: 38, height: 4, background: "rgba(0,0,0,.15)", borderRadius: 2, margin: "0 auto 16px" }} />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h3 style={{ fontSize: 17, fontWeight: 800, color: "var(--ink)", margin: 0 }}>Notifications</h3>
            <button
              onClick={onClose}
              aria-label="Close notifications"
              style={{
                background: "var(--chip)",
                border: "none",
                borderRadius: 999,
                width: 30,
                height: 30,
                font: "700 13px var(--font-body)",
                color: "rgba(0,0,0,.55)",
                cursor: "pointer",
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {loading && (
          <p style={{ font: "500 12px var(--font-body)", color: "var(--muted)", margin: "6px 2px 10px" }}>Loading…</p>
        )}

        {!loading && notifications.length === 0 && (
          <p style={{ font: "500 12.5px var(--font-body)", color: "var(--muted)", margin: "6px 2px 14px" }}>
            Nothing yet. Ride reminders, seat changes, chat messages and parking links land here.
          </p>
        )}

        {notifications.map((n) => {
          // An external link wins over the trip: a "pay for parking" row exists to be paid from.
          const actionable = n.url !== null || n.tripId !== null;
          const open = () => {
            if (n.url) {
              window.open(n.url, "_blank", "noopener,noreferrer");
              return;
            }
            if (n.tripId) onOpenTrip(n.tripId, { chat: n.type === "comment" });
          };
          const cta = actionable ? CTA[n.type] : undefined;
          return (
            <div
              key={n.id}
              onClick={() => actionable && open()}
              role={actionable ? "button" : undefined}
              tabIndex={actionable ? 0 : undefined}
              onKeyDown={(e) => {
                if (actionable && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  open();
                }
              }}
              style={{
                display: "flex",
                gap: 12,
                padding: 13,
                background: CARD_BG[n.type],
                border: "1px solid rgba(0,0,0,.06)",
                borderRadius: 15,
                marginBottom: 9,
                cursor: actionable ? "pointer" : "default",
                opacity: n.read ? 0.72 : 1,
              }}
            >
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 11,
                  background: ICON_BG[n.type],
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 16,
                  flex: "none",
                }}
              >
                {ICON[n.type]}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ font: "700 13px var(--font-body)", color: "var(--ink)", lineHeight: 1.3 }}>{n.title}</div>
                {n.body && (
                  <div style={{ font: "500 11.5px var(--font-body)", color: "rgba(0,0,0,.5)", marginTop: 3 }}>{n.body}</div>
                )}
                {cta && (
                  <span style={{ display: "inline-block", marginTop: 8, font: "800 11px var(--font-body)", color: "var(--purple)" }}>
                    {cta} →
                  </span>
                )}
              </div>
              <div style={{ font: "600 10px var(--font-body)", color: "rgba(0,0,0,.35)", flex: "none" }}>
                {relativeTime(n.createdAt)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
