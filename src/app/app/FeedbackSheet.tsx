"use client";

import { useState } from "react";

// D-25: the Profile tab's feedback form. Posts to /api/feedback, which stores the message in
// Postgres for the admin console — deliberately not email, since the project has no SMTP (D-22).

const CATEGORIES: { id: Category; label: string; icon: string }[] = [
  { id: "bug", label: "Something's broken", icon: "🐞" },
  { id: "idea", label: "I have an idea", icon: "💡" },
  { id: "praise", label: "Something I like", icon: "💚" },
  { id: "other", label: "Something else", icon: "💬" },
];

type Category = "bug" | "idea" | "praise" | "other";

const MAX = 2000;

interface Props {
  groupId: string;
  onClose: () => void;
  onSent: (message: string) => void;
}

export function FeedbackSheet({ groupId, onClose, onSent }: Props) {
  const [category, setCategory] = useState<Category>("bug");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    const trimmed = message.trim();
    if (!trimmed) {
      setError("Tell us what happened first.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, message: trimmed, groupId }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.message ?? "Couldn't send that — try again.");
        return;
      }
      onSent("Thanks — your feedback is in 💚");
    } catch {
      setError("Couldn't reach the server — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheetc" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ font: "800 17px var(--font-display)", color: "var(--ink)", margin: "0 0 2px", textAlign: "left" }}>
          Send feedback
        </h3>
        <p style={{ font: "500 11.5px var(--font-body)", color: "rgba(0,0,0,.5)", margin: "0 0 14px", textAlign: "left" }}>
          Goes straight to whoever runs Karpool here. Your name comes with it.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              onClick={() => setCategory(c.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                background: category === c.id ? "var(--purple-soft)" : "var(--surface)",
                border: category === c.id ? "1px solid rgba(124,92,255,.5)" : "1px solid rgba(0,0,0,.07)",
                borderRadius: 13,
                padding: "10px 11px",
                font: "700 11.5px var(--font-body)",
                color: category === c.id ? "var(--purple)" : "var(--ink)",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <span style={{ fontSize: 14 }}>{c.icon}</span>
              {c.label}
            </button>
          ))}
        </div>

        <textarea
          className="field"
          rows={5}
          maxLength={MAX}
          placeholder="What happened, or what would make this better?"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          style={{ resize: "vertical", minHeight: 96, fontFamily: "var(--font-body)" }}
        />
        <div style={{ font: "600 10px var(--font-body)", color: "rgba(0,0,0,.35)", textAlign: "right", marginTop: 4 }}>
          {message.length} / {MAX}
        </div>

        {error && <p style={{ color: "var(--danger)", font: "600 12px var(--font-body)", margin: "6px 2px 0" }}>{error}</p>}

        <button className="btnP" style={{ marginTop: 12 }} disabled={busy} onClick={send}>
          {busy ? "Sending…" : "Send feedback"}
        </button>
        <button className="btnG" style={{ marginTop: 8 }} onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
