"use client";

import { useAdminFetch, LoadingOrError, StatCard, td, fmtDate } from "./adminUi";

interface Health {
  push: { totalSubscriptions: number; failingSubscriptions: number; deadSubscriptions: number };
  recentCronAutoCloses: { id: string; entity_id: string | null; created_at: string }[];
  maps: { status: string; message: string };
}

export function AdminHealthTab() {
  const { data, failed, loading, reload } = useAdminFetch<Health>("/api/admin/health");
  if (loading || failed) return <LoadingOrError failed={failed} loading={loading} onRetry={reload} />;
  if (!data) return null;

  return (
    <div>
      <h3 style={{ font: "800 15px var(--font-display)", color: "var(--ink)", margin: "0 0 10px" }}>Push delivery</h3>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <StatCard label="Subscriptions" value={data.push.totalSubscriptions} />
        <StatCard label="Failing" value={data.push.failingSubscriptions} color="var(--amber-ink)" />
        <StatCard label="Dead (pruned soon)" value={data.push.deadSubscriptions} color="var(--danger)" />
      </div>

      <h3 style={{ font: "800 15px var(--font-display)", color: "var(--ink)", margin: "0 0 10px" }}>Recent cron auto-closes</h3>
      <div style={{ background: "var(--surface)", borderRadius: "var(--r-lg)", border: "1px solid var(--hairline)", marginBottom: 20 }}>
        {data.recentCronAutoCloses.length === 0 ? (
          <div style={{ padding: 14, font: "600 12.5px var(--font-body)", color: "rgba(0,0,0,.45)" }}>None — nothing has been auto-closed.</div>
        ) : (
          data.recentCronAutoCloses.map((c) => (
            <div key={c.id} style={{ ...td, borderBottom: "1px solid var(--hairline)", display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontFamily: "monospace", fontSize: 11 }}>trip:{c.entity_id?.slice(0, 8)}…</span>
              <span>{fmtDate(c.created_at)}</span>
            </div>
          ))
        )}
      </div>

      <h3 style={{ font: "800 15px var(--font-display)", color: "var(--ink)", margin: "0 0 10px" }}>Google Maps</h3>
      <div style={{ background: "var(--surface)", borderRadius: "var(--r-lg)", border: "1px solid var(--hairline)", padding: 14 }}>
        <p style={{ font: "600 12.5px var(--font-body)", color: "rgba(0,0,0,.5)", margin: 0 }}>{data.maps.message}</p>
      </div>
    </div>
  );
}
