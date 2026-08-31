"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CreateGroupSheet } from "./app/GroupScreen";
import { readJsonBody } from "@/lib/http/readJsonBody";

// Ported from the sketch's LOCKED block: authenticated users with no group see zero trips and a
// way back into the group-code step. The sketch itself has no "create a group" affordance here —
// its "+ Create a new group" button only exists inside the app's You tab, which requires already
// having a group. That leaves no path for the very first user ever to create a group, so this adds
// one (reusing the same CreateGroupSheet the in-app Group tab uses) rather than porting the gap.
export function LockedGate() {
  const router = useRouter();
  const [entering, setEntering] = useState(false);
  const [creating, setCreating] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submitCode() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/groups/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body = await readJsonBody(res);
      if (!res.ok) {
        setError(body?.message ?? "That code didn't work.");
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't reach the server — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (entering) {
    return (
      <div style={{ padding: "26px 24px" }}>
        <button className="iconbtn" style={{ marginTop: 18 }} onClick={() => setEntering(false)} aria-label="Back">
          ←
        </button>
        <div style={{ fontSize: 40, margin: "24px 0 0" }}>🔑</div>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: "var(--ink)", margin: "14px 0 6px", lineHeight: 1.1 }}>
          Enter your
          <br />
          group code
        </h1>
        <label className="lbl">Group code</label>
        <input
          className="field"
          placeholder="6-digit invite code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        {error && <p style={{ color: "var(--danger)", font: "600 12px var(--font-body)", margin: "8px 2px 0" }}>{error}</p>}
        <button className="btnP" style={{ marginTop: 18 }} disabled={busy} onClick={submitCode}>
          Join group &amp; finish
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: "26px 24px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 46 }}>🔒</div>
      <h2 style={{ fontSize: 21, fontWeight: 800, color: "var(--ink)", margin: "16px 0 6px" }}>No group yet</h2>
      <p style={{ font: "500 13px/1.5 var(--font-body)", color: "rgba(0,0,0,.5)", margin: "0 0 22px", maxWidth: 230 }}>
        You need a group to see any trips. Enter an invite code or ask your admin to add you.
      </p>
      <button className="btnP" style={{ maxWidth: 220 }} onClick={() => setEntering(true)}>
        Enter a code
      </button>
      <p style={{ margin: "14px 0 0" }}>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setCreating(true);
          }}
          style={{ font: "600 12px var(--font-body)", color: "rgba(0,0,0,.4)", textDecoration: "none" }}
        >
          Or create a new group →
        </a>
      </p>
      {creating && <CreateGroupSheet onClose={() => setCreating(false)} />}
    </div>
  );
}
