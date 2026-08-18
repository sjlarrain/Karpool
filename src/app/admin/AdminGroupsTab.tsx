"use client";

import { useAdminFetch, LoadingOrError, th, td, fmtDate } from "./adminUi";

interface GroupRow {
  id: string;
  name: string;
  code: string;
  origin_label: string;
  dest_label: string;
  created_at: string;
  memberCount: number;
  tripCount: number;
}

export function AdminGroupsTab() {
  const { data, failed, loading, reload } = useAdminFetch<{ groups: GroupRow[] }>("/api/admin/groups");
  if (loading || failed) return <LoadingOrError failed={failed} loading={loading} onRetry={reload} />;

  return (
    <div style={{ background: "var(--surface)", borderRadius: "var(--r-lg)", border: "1px solid var(--hairline)", overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={th}>Name</th>
            <th style={th}>Code</th>
            <th style={th}>Route</th>
            <th style={th}>Members</th>
            <th style={th}>Trips</th>
            <th style={th}>Created</th>
          </tr>
        </thead>
        <tbody>
          {(data?.groups ?? []).map((g) => (
            <tr key={g.id}>
              <td style={td}>{g.name}</td>
              <td style={td}>
                <span className="pill" style={{ background: "var(--chip)", color: "rgba(0,0,0,.55)" }}>
                  {g.code}
                </span>
              </td>
              <td style={td}>
                {g.origin_label} → {g.dest_label}
              </td>
              <td style={td}>{g.memberCount}</td>
              <td style={td}>{g.tripCount}</td>
              <td style={td}>{fmtDate(g.created_at)}</td>
            </tr>
          ))}
          {(data?.groups ?? []).length === 0 && (
            <tr>
              <td style={td} colSpan={6}>
                No groups yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
