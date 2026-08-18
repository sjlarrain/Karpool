"use client";

import { useState } from "react";
import { useAdminFetch, LoadingOrError, th, td, fmtDate } from "./adminUi";

interface UserRow {
  id: string;
  display_name: string;
  initials: string;
  avatar_color: string;
  platform_role: "member" | "platform_admin";
  created_at: string;
  last_seen_at: string | null;
  email: string | null;
}

interface UserDetail {
  profile: UserRow;
  memberships: { group_id: string; group_role: string; joined_at: string }[];
  tripsDriven: { id: string; group_id: string; status: string; depart_at: string }[];
  tripsRidden: { trip_id: string; state: string; joined_at: string }[];
  ledger: { id: string; kind: string; points: number; reason: string | null; created_at: string }[];
  kudosReceived: { id: string; comment: string | null; created_at: string }[];
}

export function AdminUsersTab() {
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [openUserId, setOpenUserId] = useState<string | null>(null);

  const { data, failed, loading, reload } = useAdminFetch<{ users: UserRow[]; total: number }>(
    `/api/admin/users${search ? `?search=${encodeURIComponent(search)}` : ""}`,
    [search],
  );

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <input
          className="field"
          placeholder="Search by name…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && setSearch(searchInput)}
          style={{ maxWidth: 280 }}
        />
        <button className="btnG" style={{ width: "auto", padding: "0 18px" }} onClick={() => setSearch(searchInput)}>
          Search
        </button>
      </div>

      {loading || failed ? (
        <LoadingOrError failed={failed} loading={loading} onRetry={reload} />
      ) : (
        <div style={{ background: "var(--surface)", borderRadius: "var(--r-lg)", border: "1px solid var(--hairline)", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Name</th>
                <th style={th}>Email</th>
                <th style={th}>Role</th>
                <th style={th}>Joined</th>
                <th style={th}>Last seen</th>
                <th style={th} />
              </tr>
            </thead>
            <tbody>
              {(data?.users ?? []).map((u) => (
                <tr key={u.id}>
                  <td style={td}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="av" style={{ background: u.avatar_color }}>
                        {u.initials}
                      </span>
                      {u.display_name}
                    </div>
                  </td>
                  <td style={td}>{u.email ?? "—"}</td>
                  <td style={td}>
                    <span className="pill" style={{ background: u.platform_role === "platform_admin" ? "var(--purple-soft)" : "var(--chip)", color: u.platform_role === "platform_admin" ? "var(--purple)" : "rgba(0,0,0,.55)" }}>
                      {u.platform_role === "platform_admin" ? "Platform admin" : "Member"}
                    </span>
                  </td>
                  <td style={td}>{fmtDate(u.created_at)}</td>
                  <td style={td}>{fmtDate(u.last_seen_at)}</td>
                  <td style={td}>
                    <button className="btnG" style={{ width: "auto", padding: "6px 14px", fontSize: 12 }} onClick={() => setOpenUserId(u.id)}>
                      View
                    </button>
                  </td>
                </tr>
              ))}
              {(data?.users ?? []).length === 0 && (
                <tr>
                  <td style={td} colSpan={6}>
                    No users found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {openUserId && <UserDetailPanel userId={openUserId} onClose={() => setOpenUserId(null)} onRoleChanged={reload} />}
    </div>
  );
}

function UserDetailPanel({ userId, onClose, onRoleChanged }: { userId: string; onClose: () => void; onRoleChanged: () => void }) {
  const { data, failed, loading, reload } = useAdminFetch<UserDetail>(`/api/admin/users/${userId}`, [userId]);
  const [changingRole, setChangingRole] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);

  async function changeRole(role: "member" | "platform_admin") {
    setChangingRole(true);
    setRoleError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const body = await res.json();
      if (!res.ok) {
        setRoleError(body.message ?? "Couldn't change that user's role.");
        return;
      }
      reload();
      onRoleChanged();
    } catch {
      setRoleError("Couldn't reach the server — check your connection and try again.");
    } finally {
      setChangingRole(false);
    }
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 60, display: "flex", justifyContent: "flex-end" }}
      onClick={onClose}
    >
      <div
        style={{ width: "min(480px, 100%)", background: "var(--bg)", height: "100%", overflowY: "auto", padding: 24 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ font: "800 18px var(--font-display)", color: "var(--ink)", margin: 0 }}>User detail</h2>
          <button className="iconbtn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {loading || failed ? (
          <LoadingOrError failed={failed} loading={loading} onRetry={reload} />
        ) : data ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <span className="av" style={{ background: data!.profile.avatar_color, width: 40, height: 40, fontSize: 14 }}>
                {data!.profile.initials}
              </span>
              <div>
                <div style={{ font: "800 15px var(--font-display)", color: "var(--ink)" }}>{data!.profile.display_name}</div>
                <div style={{ font: "600 12px var(--font-body)", color: "rgba(0,0,0,.45)" }}>{data!.profile.email ?? "no email on file"}</div>
              </div>
            </div>

            <label className="lbl">Platform role</label>
            <div className="seg" style={{ marginBottom: 6 }}>
              <button className={`segb ${data!.profile.platform_role === "member" ? "on" : ""}`} disabled={changingRole} onClick={() => changeRole("member")}>
                Member
              </button>
              <button className={`segb ${data!.profile.platform_role === "platform_admin" ? "on" : ""}`} disabled={changingRole} onClick={() => changeRole("platform_admin")}>
                Platform admin
              </button>
            </div>
            {roleError && <p style={{ color: "var(--danger)", font: "600 12px var(--font-body)", margin: "0 0 12px" }}>{roleError}</p>}

            <Section title={`Groups (${data!.memberships.length})`}>
              {data!.memberships.map((m) => (
                <Row key={m.group_id} left={m.group_role} right={fmtDate(m.joined_at)} />
              ))}
              {data!.memberships.length === 0 && <Empty />}
            </Section>

            <Section title={`Trips driven (${data!.tripsDriven.length})`}>
              {data!.tripsDriven.map((t) => (
                <Row key={t.id} left={t.status} right={fmtDate(t.depart_at)} />
              ))}
              {data!.tripsDriven.length === 0 && <Empty />}
            </Section>

            <Section title={`Ledger (${data!.ledger.length})`}>
              {data!.ledger.map((l) => (
                <Row key={l.id} left={`${l.kind}${l.reason ? ` — ${l.reason}` : ""}`} right={`${l.points > 0 ? "+" : ""}${l.points} pts`} />
              ))}
              {data!.ledger.length === 0 && <Empty />}
            </Section>

            <AdjustPointsForm profileId={userId} memberships={data!.memberships} onAdjusted={reload} />

            <Section title={`Kudos received (${data!.kudosReceived.length})`}>
              {data!.kudosReceived.map((k) => (
                <Row key={k.id} left={k.comment ?? "(no comment)"} right={fmtDate(k.created_at)} />
              ))}
              {data!.kudosReceived.length === 0 && <Empty />}
            </Section>
          </>
        ) : null}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <h3 style={{ font: "800 13px var(--font-display)", color: "var(--ink)", margin: "0 0 8px" }}>{title}</h3>
      <div style={{ background: "var(--surface)", borderRadius: "var(--r-md)", border: "1px solid var(--hairline)" }}>{children}</div>
    </div>
  );
}

function Row({ left, right }: { left: string; right: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "9px 12px", borderBottom: "1px solid var(--hairline)", font: "600 12.5px var(--font-body)" }}>
      <span style={{ color: "var(--ink)" }}>{left}</span>
      <span style={{ color: "rgba(0,0,0,.45)", whiteSpace: "nowrap" }}>{right}</span>
    </div>
  );
}

function Empty() {
  return <div style={{ padding: "10px 12px", font: "600 12px var(--font-body)", color: "rgba(0,0,0,.4)" }}>Nothing here.</div>;
}

// points_ledger is append-only (CLAUDE.md §3.5) — this always INSERTs a new admin_adjust row via
// POST /api/admin/ledger/adjust, never edits an existing one.
function AdjustPointsForm({
  profileId,
  memberships,
  onAdjusted,
}: {
  profileId: string;
  memberships: { group_id: string; group_role: string }[];
  onAdjusted: () => void;
}) {
  const [groupId, setGroupId] = useState(memberships[0]?.group_id ?? "");
  const [points, setPoints] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function submit() {
    setError(null);
    setSuccess(false);
    const pointsNum = Number(points);
    if (!groupId) {
      setError("This user isn't in any group yet.");
      return;
    }
    if (!Number.isInteger(pointsNum) || pointsNum === 0) {
      setError("Points must be a nonzero whole number.");
      return;
    }
    if (!reason.trim()) {
      setError("A reason is required.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/ledger/adjust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, groupId, points: pointsNum, reason: reason.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.message ?? "Couldn't apply that adjustment.");
        return;
      }
      setPoints("");
      setReason("");
      setSuccess(true);
      onAdjusted();
    } catch {
      setError("Couldn't reach the server — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (memberships.length === 0) return null;

  return (
    <Section title="Adjust points">
      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        {memberships.length > 1 && (
          <select className="field" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            {memberships.map((m) => (
              <option key={m.group_id} value={m.group_id}>
                {m.group_id}
              </option>
            ))}
          </select>
        )}
        <input className="field" placeholder="Points (e.g. -5 or 10)" value={points} onChange={(e) => setPoints(e.target.value)} />
        <input className="field" placeholder="Reason (required, logged to the audit trail)" value={reason} onChange={(e) => setReason(e.target.value)} />
        {error && <p style={{ color: "var(--danger)", font: "600 12px var(--font-body)", margin: 0 }}>{error}</p>}
        {success && <p style={{ color: "var(--green-ink)", font: "600 12px var(--font-body)", margin: 0 }}>Adjustment applied.</p>}
        <button className="btnP" disabled={busy} onClick={submit}>
          Apply adjustment
        </button>
      </div>
    </Section>
  );
}
