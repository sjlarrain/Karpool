"use client";

import { parkingLinkHost } from "@/domain/parking";

// D-54: the group's parking payment page for the leg this trip travels. Driver-only — the server
// never sends the URL to a rider — and rendered as a card in the same idiom as the pickup rows on
// the Group tab rather than as a second button competing with "End & close trip".
//
// The app's first outbound link, so it says where it goes: the host sits under the label, and the
// anchor carries rel="noopener noreferrer" so the page it opens gets no handle on this one.

interface Props {
  url: string | null;
  // The close overlay wants a nudge ("before you finish, pay"); the in-progress trip just offers it.
  hint?: string;
}

export function ParkingLink({ url, hint }: Props) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 11,
        background: "var(--surface)",
        border: "1px solid var(--hairline)",
        borderRadius: 14,
        padding: "12px 13px",
        marginBottom: 10,
        textDecoration: "none",
        textAlign: "left",
      }}
    >
      <span
        style={{
          width: 30,
          height: 30,
          borderRadius: 9,
          background: "var(--amber-soft)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 15,
          flex: "none",
        }}
      >
        🅿️
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ font: "800 13px var(--font-body)", color: "var(--ink)" }}>
          {hint ?? "Pay for parking"}
        </div>
        <div
          style={{
            font: "600 10.5px var(--font-body)",
            color: "rgba(0,0,0,.45)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {parkingLinkHost(url)}
        </div>
      </div>
      <span style={{ color: "rgba(0,0,0,.3)", fontSize: 13, flex: "none" }}>↗</span>
    </a>
  );
}
