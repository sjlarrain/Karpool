"use client";

import { relativeTime } from "@/domain/relativeTime";

// The bell's bottom sheet (sketch: "NOTIFICATIONS (from bell)"). Rows are tinted by type, carry an
// icon tile, and a `rate` row is the only actionable one in the sketch — here any row that carries a
// tripId opens that trip, since the same deep-link payload is written for start/change/reminder too.

export type NotificationItem = {
  id: string;
  type: "start" | "rate" | "change" | "comment" | "tip" | "reminder";
  title: string;
  body: string | null;
  tripId: string | null;
  read: boolean;
  createdAt: string;
};

// Sketch's type -> icon/tint maps. "reminder" post-dates the sketch (migration 0003) and reuses the
// change tint, since both are "something about the schedule needs your attention".
const ICON: Record<NotificationItem["type"], string> = {
  start: "🚗",
  rate: "💚",
  change: "⏰",
  comment: "💬",
  tip: "💡",
  reminder: "⏱️",
};

const CARD_BG: Record<NotificationItem["type"], string> = {
  start: "var(--teal-soft)",
  rate: "var(--notif-rate-bg)",
  change: "var(--amber-soft)",
  comment: "var(--surface)",
  tip: "var(--notif-tip-bg)",
  reminder: "var(--amber-soft)",
};

const ICON_BG: Record<NotificationItem["type"], string> = {
  start: "var(--teal-soft)",
  rate: "var(--notif-rate-icon)",
  change: "var(--notif-change-icon)",
  comment: "var(--chip)",
  tip: "var(--notif-tip-icon)",
  reminder: "var(--notif-change-icon)",
};

const CTA: Partial<Record<NotificationItem["type"], string>> = {
  rate: "Rate ride",
  start: "View trip",
  change: "View trip",
  reminder: "View trip",
};

type Props = {
  notifications: NotificationItem[];
  loading: boolean;
  onClose: () => void;
  onOpenTrip: (tripId: string) => void;
};

export function NotificationsSheet({ notifications, loading, onClose, onOpenTrip }: Props) {
  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheetc" onClick={(e) => e.stopPropagation()}>
        <div style={{ width: 38, height: 4, background: "rgba(0,0,0,.15)", borderRadius: 2, margin: "0 auto 16px" }} />
        <h3 style={{ fontSize: 17, fontWeight: 800, color: "var(--ink)", margin: "0 0 12px" }}>Notifications</h3>

        {loading && (
          <p style={{ font: "500 12px var(--font-body)", color: "var(--muted)", margin: "6px 2px 10px" }}>Loading…</p>
        )}

        {!loading && notifications.length === 0 && (
          <p style={{ font: "500 12.5px var(--font-body)", color: "var(--muted)", margin: "6px 2px 14px" }}>
            Nothing yet. Trip starts, schedule changes and kudos prompts land here.
          </p>
        )}

        {notifications.map((n) => {
          const actionable = n.tripId !== null;
          const cta = actionable ? CTA[n.type] : undefined;
          return (
            <div
              key={n.id}
              onClick={() => actionable && n.tripId && onOpenTrip(n.tripId)}
              role={actionable ? "button" : undefined}
              tabIndex={actionable ? 0 : undefined}
              onKeyDown={(e) => {
                if (actionable && n.tripId && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  onOpenTrip(n.tripId);
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
