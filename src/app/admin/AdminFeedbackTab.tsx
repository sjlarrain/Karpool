"use client";

import { useState } from "react";
import { useAdminFetch, LoadingOrError, th, td, fmtDate } from "./adminUi";

interface FeedbackRow {
  id: string;
  category: "bug" | "idea" | "praise" | "other";
  message: string;
  userAgent: string | null;
  createdAt: string;
  senderName: string;
  groupName: string | null;
}

const CATEGORY_STYLE: Record<FeedbackRow["category"], { label: string; bg: string; color: string }> = {
  bug: { label: "🐞 Bug", bg: "var(--amber-soft)", color: "var(--danger)" },
  idea: { label: "💡 Idea", bg: "var(--purple-soft)", color: "var(--purple)" },
  praise: { label: "💚 Praise", bg: "var(--green-soft)", color: "var(--teal-ink)" },
  other: { label: "💬 Other", bg: "var(--chip)", color: "rgba(0,0,0,.55)" },
};

// D-25: read-only. Feedback is a record of what someone actually said — an admin editing it would
// make it worthless, so there is no write path here, the same reasoning as the audit log (D-14).
export function AdminFeedbackTab() {
  const [category, setCategory] = useState("");

  const { data, failed, loading, reload } = useAdminFetch<{ entries: FeedbackRow[]; total: number }>(
    `/api/admin/feedback${category ? `?category=${category}` : ""}`,
    [category],
  );

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <select className="field" value={category} onChange={(e) => setCategory(e.target.value)} style={{ maxWidth: 220 }}>
          <option value="">All feedback</option>
          <option value="bug">Bugs</option>
          <option value="idea">Ideas</option>
          <option value="praise">Praise</option>
          <option value="other">Other</option>
        </select>
        {data && (
          <span style={{ font: "600 12px var(--font-body)", color: "rgba(0,0,0,.45)" }}>
            {data.total} message{data.total === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {loading || failed ? (
        <LoadingOrError failed={failed} loading={loading} onRetry={reload} />
      ) : (data?.entries ?? []).length === 0 ? (
        <p style={{ font: "600 12px var(--font-body)", color: "rgba(0,0,0,.45)" }}>
          Nothing yet. Feedback arrives here from the Profile tab&apos;s &ldquo;Send feedback&rdquo; form.
        </p>
      ) : (
        <div
          style={{
            background: "var(--surface)",
            borderRadius: "var(--r-lg)",
            border: "1px solid var(--hairline)",
            overflowX: "auto",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Type</th>
                <th style={th}>Message</th>
                <th style={th}>From</th>
                <th style={th}>Group</th>
                <th style={th}>When</th>
              </tr>
            </thead>
            <tbody>
              {(data?.entries ?? []).map((f) => {
                const style = CATEGORY_STYLE[f.category];
                return (
                  <tr key={f.id}>
                    <td style={td}>
                      <span className="pill" style={{ background: style.bg, color: style.color, whiteSpace: "nowrap" }}>
                        {style.label}
                      </span>
                    </td>
                    <td style={{ ...td, whiteSpace: "pre-wrap", minWidth: 260, maxWidth: 520 }}>
                      {f.message}
                      {f.userAgent && (
                        <div style={{ font: "500 10px var(--font-body)", color: "rgba(0,0,0,.35)", marginTop: 4 }}>
                          {f.userAgent}
                        </div>
                      )}
                    </td>
                    <td style={td}>{f.senderName}</td>
                    <td style={td}>{f.groupName ?? "—"}</td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>{fmtDate(f.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
