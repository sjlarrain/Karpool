"use client";

import { useAdminFetch, LoadingOrError, StatCard } from "./adminUi";

interface Metrics {
  userCount: number;
  groupCount: number;
  ledgerEntryCount: number;
  totalTrips: number;
  tripsByStatus: { scheduled: number; started: number; closed: number; cancelled: number };
}

export function AdminOverviewTab() {
  const { data, failed, loading, reload } = useAdminFetch<Metrics>("/api/admin/metrics");
  if (loading || failed) return <LoadingOrError failed={failed} loading={loading} onRetry={reload} />;
  if (!data) return null;

  return (
    <div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <StatCard label="Users" value={data.userCount} />
        <StatCard label="Groups" value={data.groupCount} />
        <StatCard label="Total trips" value={data.totalTrips} />
        <StatCard label="Ledger entries" value={data.ledgerEntryCount} />
      </div>
      <h3 style={{ font: "800 15px var(--font-display)", color: "var(--ink)", margin: "0 0 10px" }}>Trips by status</h3>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <StatCard label="Scheduled" value={data.tripsByStatus.scheduled} color="var(--teal-ink)" />
        <StatCard label="Started" value={data.tripsByStatus.started} color="var(--purple)" />
        <StatCard label="Closed" value={data.tripsByStatus.closed} color="var(--green-ink)" />
        <StatCard label="Cancelled" value={data.tripsByStatus.cancelled} color="var(--danger)" />
      </div>
    </div>
  );
}
