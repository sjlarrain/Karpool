"use client";

import { useEffect, useState } from "react";
import type { RankedRow } from "@/domain/leaderboard";

interface LeaderboardResponse {
  entries: RankedRow[];
  formula: string;
  viewerProfileId: string;
}

export function RanksScreen({ groupId }: { groupId: string }) {
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    fetch(`/api/groups/${groupId}/leaderboard`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`status ${res.status}`))))
      .then((body) => {
        if (!cancelled) setData(body);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [groupId, reloadKey]);

  if (failed) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10 }}>
        <p style={{ font: "600 12.5px var(--font-body)", color: "rgba(0,0,0,.45)" }}>Couldn&apos;t load the leaderboard.</p>
        <button className="btnG" style={{ width: "auto", padding: "10px 20px" }} onClick={() => setReloadKey((k) => k + 1)}>
          Retry
        </button>
      </div>
    );
  }

  if (!data) {
    return <div style={{ flex: 1 }} />;
  }

  const me = data.entries.find((r) => r.profileId === data.viewerProfileId);
  const myRank = me?.rank ?? data.entries.length;

  return (
    <div className="scroll" style={{ padding: "0 20px 18px" }}>
      <div
        style={{
          background: "linear-gradient(130deg, var(--purple), var(--purple-deep))",
          borderRadius: 20,
          padding: 18,
          color: "var(--surface)",
          marginBottom: 16,
        }}
      >
        <div style={{ font: "700 11px var(--font-body)", opacity: 0.85, letterSpacing: ".04em" }}>YOUR SCORE · THIS MONTH</div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8, marginTop: 4 }}>
          <span style={{ font: "800 40px var(--font-display)", lineHeight: 1 }}>{me?.points ?? 0}</span>
          <span style={{ font: "700 13px var(--font-body)", opacity: 0.85, marginBottom: 7 }}>pts · rank #{myRank}</span>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <div style={{ flex: 1, background: "rgba(255,255,255,.15)", borderRadius: 12, padding: "9px 11px" }}>
            <div style={{ font: "800 18px var(--font-display)" }}>{me?.driven ?? 0}</div>
            <div style={{ fontSize: 10, opacity: 0.85 }}>🚗 Driven</div>
          </div>
          <div style={{ flex: 1, background: "rgba(255,255,255,.15)", borderRadius: 12, padding: "9px 11px" }}>
            <div style={{ font: "800 18px var(--font-display)" }}>{me?.pooled ?? 0}</div>
            <div style={{ fontSize: 10, opacity: 0.85 }}>🧍 Pooled</div>
          </div>
          <div style={{ flex: 1, background: "rgba(255,255,255,.15)", borderRadius: 12, padding: "9px 11px" }}>
            <div style={{ font: "800 18px var(--font-display)" }}>{me?.kudos ?? 0}</div>
            <div style={{ fontSize: 10, opacity: 0.85 }}>💚 Kudos</div>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <h3 style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)", margin: 0 }}>Leaderboard</h3>
        <span style={{ font: "600 10.5px var(--font-body)", color: "rgba(0,0,0,.4)" }}>{data.formula}</span>
      </div>

      {data.entries.length === 0 && (
        <p style={{ font: "500 12.5px var(--font-body)", color: "rgba(0,0,0,.45)", margin: "4px 2px" }}>
          No scores this month yet — points land here once a trip is closed.
        </p>
      )}

      {data.entries.map((r) => {
        const isMe = r.profileId === data.viewerProfileId;
        return (
          <div
            key={r.profileId}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 11,
              background: isMe ? "var(--purple-soft)" : "var(--surface)",
              border: `1px solid ${isMe ? "rgba(124,92,255,.35)" : "rgba(0,0,0,.06)"}`,
              borderRadius: 15,
              padding: "11px 13px",
              marginBottom: 8,
            }}
          >
            <div style={{ width: 26, textAlign: "center", font: "800 15px var(--font-display)", color: r.medal ? "var(--ink)" : "rgba(0,0,0,.4)" }}>
              {r.medal ?? r.rank}
            </div>
            <span className="av" style={{ background: r.color, width: 34, height: 34, borderRadius: 11, fontSize: 12 }}>
              {r.initials}
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ font: "700 14px var(--font-display)", color: "var(--ink)" }}>{isMe ? "You" : r.name}</div>
              <div style={{ font: "600 10.5px var(--font-body)", color: "rgba(0,0,0,.45)" }}>
                {r.driven} driven · {r.pooled} pooled · {r.kudos} kudos
              </div>
            </div>
            <div style={{ font: "800 16px var(--font-display)", color: "var(--ink)" }}>{r.points}</div>
          </div>
        );
      })}
    </div>
  );
}
