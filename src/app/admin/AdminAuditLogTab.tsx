"use client";

import { Fragment, useState } from "react";
import { useAdminFetch, LoadingOrError, th, td, fmtDate } from "./adminUi";

interface AuditRow {
  id: string;
  actor_profile_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}

// Read-only — audit_log has no UPDATE/DELETE path anywhere, including for admins (D-14).
export function AdminAuditLogTab() {
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const params = new URLSearchParams();
  if (action) params.set("action", action);
  if (entityType) params.set("entityType", entityType);

  const { data, failed, loading, reload } = useAdminFetch<{ entries: AuditRow[] }>(
    `/api/admin/audit-log${params.toString() ? `?${params}` : ""}`,
    [action, entityType],
  );
  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <select className="field" value={action} onChange={(e) => setAction(e.target.value)} style={{ maxWidth: 220 }}>
          <option value="">All actions</option>
          <option value="view_user_detail">view_user_detail</option>
          <option value="update_user_role">update_user_role</option>
          <option value="force_close_trip">force_close_trip</option>
          <option value="admin_adjust_ledger">admin_adjust_ledger</option>
          <option value="cron_auto_close">cron_auto_close</option>
        </select>
        <select className="field" value={entityType} onChange={(e) => setEntityType(e.target.value)} style={{ maxWidth: 220 }}>
          <option value="">All entity types</option>
          <option value="profile">profile</option>
          <option value="trip">trip</option>
          <option value="points_ledger">points_ledger</option>
        </select>
      </div>

      {loading || failed ? (
        <LoadingOrError failed={failed} loading={loading} onRetry={reload} />
      ) : (
        <div style={{ background: "var(--surface)", borderRadius: "var(--r-lg)", border: "1px solid var(--hairline)", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Action</th>
                <th style={th}>Entity</th>
                <th style={th}>Actor</th>
                <th style={th}>IP</th>
                <th style={th}>When</th>
              </tr>
            </thead>
            <tbody>
              {(data?.entries ?? []).map((e) => (
                <Fragment key={e.id}>
                  <tr style={{ cursor: "pointer" }} onClick={() => setExpanded(expanded === e.id ? null : e.id)}>
                    <td style={td}>
                      <span className="pill" style={{ background: "var(--chip)", color: "rgba(0,0,0,.55)" }}>
                        {e.action}
                      </span>
                    </td>
                    <td style={{ ...td, fontFamily: "monospace", fontSize: 11 }}>
                      {e.entity_type}:{e.entity_id ? `${e.entity_id.slice(0, 8)}…` : "—"}
                    </td>
                    <td style={{ ...td, fontFamily: "monospace", fontSize: 11 }}>
                      {e.actor_profile_id ? `${e.actor_profile_id.slice(0, 8)}…` : "system"}
                    </td>
                    <td style={td}>{e.ip ?? "—"}</td>
                    <td style={td}>{fmtDate(e.created_at)}</td>
                  </tr>
                  {expanded === e.id && (
                    <tr>
                      <td style={{ ...td, background: "var(--chip)" }} colSpan={5}>
                        <pre style={{ margin: 0, whiteSpace: "pre-wrap", font: "500 11px monospace" }}>
                          {JSON.stringify({ before: e.before, after: e.after, user_agent: e.user_agent }, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {(data?.entries ?? []).length === 0 && (
                <tr>
                  <td style={td} colSpan={5}>
                    No audit entries found.
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
