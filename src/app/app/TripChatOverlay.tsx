"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readJsonBody } from "@/lib/http/readJsonBody";
import { relativeTime } from "@/domain/relativeTime";
import {
  MAX_MESSAGE_LENGTH,
  QUICK_MESSAGES,
  groupMessages,
  normalizeMessageBody,
  type ChatMessage,
} from "@/domain/tripChat";

// D-57 — the per-trip thread, as a screen.
//
// The developer asked for a way "to tell important messages to the people that is being pool.
// Example: I wait you here. I am here". Two of the three things that implies are not the message
// list: the quick chips, so nobody types "I'm here" while standing in the rain, and the poll, so a
// rider watching this screen sees the driver's message without pulling to refresh. This app has no
// realtime channel (the infrastructure lineament is Supabase + Web Push and nothing else), so the
// poll is a plain interval, running only while this overlay is open.

interface Props {
  tripId: string;
  // Shown under the title so the thread is anchored to a ride rather than floating: "Today · 07:45".
  subtitle: string;
  onClose: () => void;
}

const POLL_MS = 12_000;

export function TripChatOverlay({ tripId, subtitle, onClose }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [canPost, setCanPost] = useState(false);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/trips/${tripId}/messages`);
      const body = res.ok ? await readJsonBody<{ messages: ChatMessage[]; canPost: boolean }>(res) : null;
      if (!body) {
        setError("Couldn't load the chat.");
        return;
      }
      setMessages(body.messages);
      setCanPost(body.canPost);
      setError(null);
    } catch {
      setError("Couldn't reach the server — check your connection.");
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    load();
    const timer = setInterval(load, POLL_MS);
    // Cleared on unmount, so a closed overlay never keeps polling in the background — on a phone
    // that would be a request every twelve seconds for as long as the app stayed open.
    return () => clearInterval(timer);
  }, [load]);

  // The newest message is the one you came for, so the thread opens at the bottom and stays there.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  async function send(text: string) {
    const body = normalizeMessageBody(text);
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/trips/${tripId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const reply = await readJsonBody(res);
      if (!res.ok) {
        setError(reply?.message ?? "That didn't send.");
        return;
      }
      // Cleared only on success, so a failed send leaves the words in the box rather than losing
      // them — the whole message is usually shorter than retyping it is annoying, but not always.
      setDraft("");
      await load();
    } catch {
      setError("Couldn't reach the server — check your connection.");
    } finally {
      setSending(false);
    }
  }

  const runs = groupMessages(messages);
  const now = new Date();

  return (
    <div className="ov">
      <div
        style={{
          padding: "44px 18px 12px",
          flex: "none",
          display: "flex",
          alignItems: "center",
          gap: 12,
          borderBottom: "1px solid rgba(0,0,0,.06)",
        }}
      >
        <button className="iconbtn" onClick={onClose} aria-label="Back">
          ←
        </button>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: "var(--ink)", margin: 0 }}>Trip chat</h2>
          <div
            style={{
              font: "600 11px var(--font-body)",
              color: "rgba(0,0,0,.45)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {subtitle}
          </div>
        </div>
      </div>

      <div className="scroll" style={{ padding: "16px 18px 8px", flex: 1 }}>
        {loading && (
          <p style={{ font: "500 12.5px var(--font-body)", color: "rgba(0,0,0,.45)", margin: 0 }}>Loading…</p>
        )}

        {!loading && messages.length === 0 && (
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--hairline)",
              borderRadius: 16,
              padding: "18px 16px",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 26, marginBottom: 6 }}>💬</div>
            <div style={{ font: "800 13.5px var(--font-display)", color: "var(--ink)", marginBottom: 4 }}>
              Nothing said yet
            </div>
            <p style={{ font: "500 12px var(--font-body)", color: "rgba(0,0,0,.5)", margin: 0, lineHeight: 1.5 }}>
              This is for the ride itself — where you&apos;re waiting, when you&apos;re there, if
              you&apos;re running late. Only the driver and the people with a seat can see it.
            </p>
          </div>
        )}

        {runs.map((run) => (
          <div
            key={run.messages[0]!.id}
            style={{
              display: "flex",
              gap: 9,
              marginBottom: 14,
              flexDirection: run.mine ? "row-reverse" : "row",
            }}
          >
            <span className="av" style={{ background: run.color, flex: "none" }}>
              {run.initials}
            </span>
            <div style={{ minWidth: 0, maxWidth: "78%" }}>
              <div
                style={{
                  font: "700 10.5px var(--font-body)",
                  color: "rgba(0,0,0,.42)",
                  margin: "1px 3px 4px",
                  textAlign: run.mine ? "right" : "left",
                }}
              >
                {run.mine ? "You" : run.authorName} · {relativeTime(run.messages[0]!.createdAt, now)}
              </div>
              {run.messages.map((m) => (
                <div
                  key={m.id}
                  style={{
                    background: run.mine ? "var(--purple-soft)" : "var(--surface)",
                    border: `1px solid ${run.mine ? "rgba(124,92,255,.28)" : "var(--hairline)"}`,
                    borderRadius: 15,
                    padding: "9px 12px",
                    marginBottom: 5,
                    font: "600 13px var(--font-body)",
                    color: "var(--ink)",
                    lineHeight: 1.45,
                    whiteSpace: "pre-wrap",
                    overflowWrap: "anywhere",
                  }}
                >
                  {m.body}
                </div>
              ))}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div style={{ flex: "none", padding: "8px 18px 22px", borderTop: "1px solid rgba(0,0,0,.06)" }}>
        {error && (
          <p style={{ color: "var(--danger)", font: "600 11.5px var(--font-body)", margin: "0 0 8px" }}>{error}</p>
        )}

        {!canPost && !loading ? (
          <p style={{ font: "500 12px var(--font-body)", color: "rgba(0,0,0,.45)", margin: "8px 0 0", textAlign: "center" }}>
            This trip is over — its chat is read-only now.
          </p>
        ) : (
          <>
            {/* The developer's own examples, one tap each. Same route, same validation as anything
                typed by hand — a chip is a shortcut, not a second kind of message. */}
            <div style={{ display: "flex", gap: 6, overflowX: "auto", padding: "2px 0 9px" }}>
              {QUICK_MESSAGES.map((quick) => (
                <button
                  key={quick}
                  disabled={sending}
                  onClick={() => send(quick)}
                  className="pill"
                  style={{
                    background: "var(--chip)",
                    color: "rgba(0,0,0,.62)",
                    border: "1px solid var(--hairline)",
                    cursor: sending ? "not-allowed" : "pointer",
                    whiteSpace: "nowrap",
                    flex: "none",
                  }}
                >
                  {quick}
                </button>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, MAX_MESSAGE_LENGTH))}
                onKeyDown={(e) => {
                  // Enter sends, Shift+Enter breaks the line — the phone keyboard's return key is
                  // the one people reach for, and a two-line message is the rare case.
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send(draft);
                  }
                }}
                placeholder="Say something to the car…"
                rows={1}
                style={{
                  flex: 1,
                  resize: "none",
                  maxHeight: 96,
                  background: "var(--surface)",
                  border: "1px solid var(--hairline)",
                  borderRadius: 15,
                  padding: "11px 13px",
                  font: "600 13px var(--font-body)",
                  color: "var(--ink)",
                  outline: "none",
                }}
              />
              <button
                className="btnP"
                disabled={sending || normalizeMessageBody(draft) === null}
                onClick={() => send(draft)}
                style={{ width: "auto", padding: "12px 18px", flex: "none", opacity: normalizeMessageBody(draft) === null ? 0.5 : 1 }}
              >
                Send
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
