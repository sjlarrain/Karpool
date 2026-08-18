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

export function AdminTripsTab() {
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>("all");
  const [forceCloseTrip, setForceCloseTrip] = useState<TripRow | null>(null);

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
                <th style={th} />
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
                  <td style={td}>
                    {(t.status === "scheduled" || t.status === "started") && (
                      <button className="btnG" style={{ width: "auto", padding: "6px 14px", fontSize: 12, background: "var(--danger)" }} onClick={() => setForceCloseTrip(t)}>
                        Force close
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {(data?.trips ?? []).length === 0 && (
                <tr>
                  <td style={td} colSpan={6}>
                    No trips found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {forceCloseTrip && (
        <ForceCloseModal trip={forceCloseTrip} onClose={() => setForceCloseTrip(null)} onDone={() => { setForceCloseTrip(null); reload(); }} />
      )}
    </div>
  );
}

function ForceCloseModal({ trip, onClose, onDone }: { trip: TripRow; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/trips/${trip.id}/force-close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.message ?? "Couldn't force-close that trip.");
        return;
      }
      onDone();
    } catch {
      setError("Couldn't reach the server — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ width: "min(420px, 92vw)", background: "var(--bg)", borderRadius: "var(--r-xl)", padding: 20 }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ font: "800 16px var(--font-display)", color: "var(--ink)", margin: "0 0 6px" }}>Force-close this trip?</h3>
        <p style={{ font: "600 12.5px var(--font-body)", color: "rgba(0,0,0,.5)", margin: "0 0 14px" }}>
          This is a safety-net action — it never touches the points ledger, since nobody confirmed who actually rode.
        </p>
        <label className="lbl">Reason (required, logged to the audit trail)</label>
        <textarea
          className="field"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          style={{ marginBottom: 10, resize: "vertical" }}
        />
        {error && <p style={{ color: "var(--danger)", font: "600 12px var(--font-body)", margin: "0 0 10px" }}>{error}</p>}
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btnG" style={{ flex: 1 }} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btnP" style={{ flex: 1, background: "var(--danger)", boxShadow: "none" }} onClick={submit} disabled={busy}>
            Force close
          </button>
        </div>
      </div>
    </div>
  );
}
