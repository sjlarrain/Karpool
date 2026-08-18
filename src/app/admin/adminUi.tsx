"use client";

// Shared bits reused across every admin tab — a fetch-with-retry hook and a couple of small
// presentational pieces. The admin console has no sketch/mock to match (D-07 predates a design),
// so this leans on the same tokens/colors as the rest of the app but uses a table-first, wider
// desktop layout instead of the app's 430px phone frame — an admin console is used from a desk.

import { useEffect, useState } from "react";

export function useAdminFetch<T>(url: string, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    fetch(url)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`status ${res.status}`))))
      .then((body) => {
        if (!cancelled) setData(body);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, reloadKey, ...deps]);

  return { data, failed, loading, reload: () => setReloadKey((k) => k + 1) };
}

export function LoadingOrError({ failed, loading, onRetry }: { failed: boolean; loading: boolean; onRetry: () => void }) {
  if (failed) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, padding: 40 }}>
        <p style={{ font: "600 13px var(--font-body)", color: "rgba(0,0,0,.45)" }}>Couldn&apos;t load that.</p>
        <button className="btnG" style={{ width: "auto", padding: "10px 20px" }} onClick={onRetry}>
          Retry
        </button>
      </div>
    );
  }
  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", font: "600 13px var(--font-body)", color: "rgba(0,0,0,.4)" }}>Loading…</div>;
  }
  return null;
}

export const th: React.CSSProperties = {
  textAlign: "left",
  font: "700 10.5px var(--font-body)",
  textTransform: "uppercase",
  letterSpacing: ".04em",
  color: "rgba(0,0,0,.45)",
  padding: "8px 12px",
  borderBottom: "1px solid var(--hairline)",
  whiteSpace: "nowrap",
};

export const td: React.CSSProperties = {
  font: "600 13px var(--font-body)",
  color: "var(--ink)",
  padding: "10px 12px",
  borderBottom: "1px solid var(--hairline)",
  verticalAlign: "top",
};

export function StatCard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--hairline)", borderRadius: "var(--r-lg)", padding: "14px 16px", flex: 1, minWidth: 120 }}>
      <div style={{ font: "700 10.5px var(--font-body)", color: "rgba(0,0,0,.45)", textTransform: "uppercase", letterSpacing: ".04em" }}>{label}</div>
      <div style={{ font: "800 24px var(--font-display)", color: color ?? "var(--ink)", marginTop: 4 }}>{value}</div>
    </div>
  );
}

export function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
