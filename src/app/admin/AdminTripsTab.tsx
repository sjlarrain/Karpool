"use client";

import { useState } from "react";
import { useAdminFetch, LoadingOrError, th, td, fmtDate } from "./adminUi";

interface TripRow {
  id: string;
  group_id: string;
  driver_id: string;
  direction: string;
  depart_at: string;
  status: "scheduled" | "started" | "closed" | "cancelled";
  started_at: string | null;
  closed_at: string | null;
}

const STATUS_FILTERS = ["all", "scheduled", "started", "closed", "cancelled"] as const;

// D-61: read-only. Force-start and force-close are gone with the taps they stood in for — the
// scheduler settles every trip at its departure, so there is no trip left for an admin to rescue.
export function AdminTripsTab() {
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>("all");

  const { data, failed, loading, reload } = useAdminFetch<{ trips: TripRow[] }>(
    `/api/admin/trips${status !== "all" ? `?status=${status}` : ""}`,
    [status],
  );

  return (
    <div>
      <div className="seg" style={{ marginBottom: 14, maxWidth: 460 }}>
        {STATUS_FILTERS.map((s) => (
          <button key={s} className={`segb ${status === s ? "on" : ""}`} onClick={() => setStatus(s)}>
            {s === "all" ? "All" : s[0]!.toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {loading || failed ? (
        <LoadingOrError failed={failed} loading={loading} onRetry={reload} />
      ) : (
        <div style={{ background: "var(--surface)", borderRadius: "var(--r-lg)", border: "1px solid var(--hairline)", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Direction</th>
                <th style={th}>Departs</th>
                <th style={th}>Status</th>
                <th style={th}>Started</th>
                <th style={th}>Closed</th>
              </tr>
            </thead>
            <tbody>
              {(data?.trips ?? []).map((t) => (
                <tr key={t.id}>
                  <td style={td}>{t.direction}</td>
                  <td style={td}>{fmtDate(t.depart_at)}</td>
                  <td style={td}>
                    <span className="pill" style={{ background: "var(--chip)", color: "rgba(0,0,0,.55)" }}>
                      {t.status}
                    </span>
                  </td>
                  <td style={td}>{fmtDate(t.started_at)}</td>
                  <td style={td}>{fmtDate(t.closed_at)}</td>
                </tr>
              ))}
              {(data?.trips ?? []).length === 0 && (
                <tr>
                  <td style={td} colSpan={5}>
                    No trips found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
