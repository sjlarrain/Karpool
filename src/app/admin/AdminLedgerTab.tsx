"use client";

import { useState } from "react";
import { useAdminFetch, LoadingOrError, th, td, fmtDate } from "./adminUi";

interface LedgerRow {
  id: string;
  profile_id: string;
  group_id: string;
  trip_id: string | null;
  kind: "drive" | "pool" | "kudos" | "late_leave" | "admin_adjust";
  points: number;
  reason: string | null;
  created_at: string;
}

// Read-only browse of the full ledger, filterable by profile/group id. Manual adjustments are made
// from a specific user's detail panel in the Users tab (it already knows their id and groups) rather
// than a generic id-entry form here.
export function AdminLedgerTab() {
  const [profileId, setProfileId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [appliedProfileId, setAppliedProfileId] = useState("");
  const [appliedGroupId, setAppliedGroupId] = useState("");

  const params = new URLSearchParams();
  if (appliedProfileId) params.set("profileId", appliedProfileId);
  if (appliedGroupId) params.set("groupId", appliedGroupId);

  const { data, failed, loading, reload } = useAdminFetch<{ entries: LedgerRow[] }>(
    `/api/admin/ledger${params.toString() ? `?${params}` : ""}`,
    [appliedProfileId, appliedGroupId],
  );
  function applyFilters() {
    setAppliedProfileId(profileId.trim());
    setAppliedGroupId(groupId.trim());
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <input className="field" placeholder="Filter by profile id…" value={profileId} onChange={(e) => setProfileId(e.target.value)} style={{ maxWidth: 260 }} />
        <input className="field" placeholder="Filter by group id…" value={groupId} onChange={(e) => setGroupId(e.target.value)} style={{ maxWidth: 260 }} />
        <button className="btnG" style={{ width: "auto", padding: "0 18px" }} onClick={applyFilters}>
          Apply
        </button>
      </div>
      <p style={{ font: "600 11.5px var(--font-body)", color: "rgba(0,0,0,.4)", margin: "0 0 12px" }}>
        To make a manual adjustment, open a user in the Users tab — it has an &quot;Adjust points&quot; action with their id and groups already filled in.
      </p>

      {loading || failed ? (
        <LoadingOrError failed={failed} loading={loading} onRetry={reload} />
      ) : (
        <div style={{ background: "var(--surface)", borderRadius: "var(--r-lg)", border: "1px solid var(--hairline)", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Kind</th>
                <th style={th}>Points</th>
                <th style={th}>Reason</th>
                <th style={th}>Profile id</th>
                <th style={th}>Group id</th>
                <th style={th}>When</th>
              </tr>
            </thead>
            <tbody>
              {(data?.entries ?? []).map((e) => (
                <tr key={e.id}>
                  <td style={td}>
                    <span className="pill" style={{ background: e.kind === "admin_adjust" ? "var(--amber-soft)" : "var(--chip)", color: e.kind === "admin_adjust" ? "var(--amber-ink)" : "rgba(0,0,0,.55)" }}>
                      {e.kind}
                    </span>
                  </td>
                  <td style={{ ...td, color: e.points >= 0 ? "var(--green-ink)" : "var(--danger)", fontWeight: 800 }}>
                    {e.points > 0 ? "+" : ""}
                    {e.points}
                  </td>
                  <td style={td}>{e.reason ?? "—"}</td>
                  <td style={{ ...td, fontFamily: "monospace", fontSize: 11 }}>{e.profile_id.slice(0, 8)}…</td>
                  <td style={{ ...td, fontFamily: "monospace", fontSize: 11 }}>{e.group_id.slice(0, 8)}…</td>
                  <td style={td}>{fmtDate(e.created_at)}</td>
                </tr>
              ))}
              {(data?.entries ?? []).length === 0 && (
                <tr>
                  <td style={td} colSpan={6}>
                    No ledger entries found.
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
