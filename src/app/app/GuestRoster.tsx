"use client";

import { useCallback, useEffect, useState } from "react";
import { readJsonBody } from "@/lib/http/readJsonBody";

// D-55: the group's guest roster, and the place a group admin links one of those guests to the
// member who turns out to be that person.
//
// Admin-managed, following D-29's rule for the other list in this app ("the place list stays
// manager-managed and fixed — tags can be overpopulated"). A driver picks from it when seating
// someone; only an admin adds to it, and only an admin links.

interface Guest {
  id: string;
  displayName: string;
  initials: string;
  color: string;
  rides: number;
  claimedBy: { profileId: string; name: string } | null;
  claimedAt: string | null;
}

interface Member {
  profileId: string;
  name: string;
  initials: string;
  color: string;
}

export function GuestRoster({ groupId, isAdmin }: { groupId: string; isAdmin: boolean }) {
  const [guests, setGuests] = useState<Guest[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [linking, setLinking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/groups/${groupId}/guests`);
      const body = await readJsonBody<{ guests: Guest[]; members: Member[] }>(res);
      if (!res.ok || !body) return;
      setGuests(body.guests);
      setMembers(body.members ?? []);
    } catch {
      // A failed load leaves the section empty rather than showing a broken list. The Group tab has
      // plenty else on it, and this is not worth an error banner of its own.
    } finally {
      setLoaded(true);
    }
  }, [groupId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function send(path: string, method: "POST" | "DELETE", payload?: unknown, fallback = "That did not work.") {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(path, {
        method,
        ...(payload === undefined
          ? {}
          : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
      });
      const body = await readJsonBody(res);
      if (!res.ok) {
        setError(body?.message ?? fallback);
        return false;
      }
      await load();
      return true;
    } catch {
      setError("Couldn't reach the server — check your connection and try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return null;
  // Nothing to show a plain member until someone has actually ridden as a guest.
  if (!isAdmin && guests.length === 0) return null;

  return (
    <>
      <label className="lbl" style={{ textAlign: "left" }}>
        Guest list
      </label>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
        {guests.length === 0 && (
          <p style={{ font: "500 12px var(--font-body)", color: "rgba(0,0,0,.4)" }}>
            No guests yet. Add the people who ride without an account and their trips start counting.
          </p>
        )}

        {guests.map((g) => (
          <div
            key={g.id}
            style={{
              background: "var(--surface)",
              border: "1px solid rgba(0,0,0,.08)",
              borderRadius: 14,
              padding: "12px 13px",
              textAlign: "left",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
              <span
                className="av"
                style={{
                  background: g.claimedBy ? g.color : "var(--chip)",
                  color: g.claimedBy ? undefined : "rgba(0,0,0,.45)",
                  border: g.claimedBy ? undefined : "1.5px dashed rgba(0,0,0,.18)",
                  width: 30,
                  height: 30,
                  borderRadius: 9,
                  fontSize: 11,
                  flex: "none",
                }}
              >
                {g.initials}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: "800 13px var(--font-body)", color: "var(--ink)" }}>{g.displayName}</div>
                <div style={{ font: "600 10.5px var(--font-body)", color: "rgba(0,0,0,.45)" }}>
                  {g.rides} ride{g.rides === 1 ? "" : "s"}
                  {g.claimedBy ? ` · counting for ${g.claimedBy.name}` : " · not registered yet"}
                </div>
              </div>
              {isAdmin && (
                <button
                  disabled={busy}
                  onClick={() =>
                    g.claimedBy
                      ? void send(`/api/groups/${groupId}/guests/${g.id}/claim`, "DELETE", undefined, "Couldn't unlink that guest.")
                      : setLinking(linking === g.id ? null : g.id)
                  }
                  style={{
                    background: "none",
                    border: "none",
                    color: g.claimedBy ? "rgba(0,0,0,.35)" : "var(--purple)",
                    font: "800 11px var(--font-body)",
                    cursor: "pointer",
                    padding: 4,
                    flex: "none",
                  }}
                >
                  {g.claimedBy ? "Unlink" : "Link"}
                </button>
              )}
              {isAdmin && !g.claimedBy && g.rides === 0 && (
                <button
                  disabled={busy}
                  aria-label={`Delete ${g.displayName}`}
                  onClick={() => void send(`/api/groups/${groupId}/guests/${g.id}`, "DELETE", undefined, "Couldn't delete that guest.")}
                  style={{
                    background: "none",
                    border: "none",
                    color: "rgba(0,0,0,.28)",
                    font: "700 11px var(--font-body)",
                    cursor: "pointer",
                    padding: 4,
                    flex: "none",
                  }}
                >
                  ✕
                </button>
              )}
            </div>

            {linking === g.id && (
              <div style={{ marginTop: 10, borderTop: "1px solid rgba(0,0,0,.06)", paddingTop: 10 }}>
                <p style={{ font: "500 11px var(--font-body)", color: "rgba(0,0,0,.5)", margin: "0 0 8px" }}>
                  Who is {g.displayName}? Their {g.rides} ride{g.rides === 1 ? "" : "s"} move onto that member&apos;s
                  score straight away, and Unlink puts them back.
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {members.map((m) => (
                    <button
                      key={m.profileId}
                      disabled={busy}
                      onClick={async () => {
                        const ok = await send(
                          `/api/groups/${groupId}/guests/${g.id}/claim`,
                          "POST",
                          { profileId: m.profileId },
                          "Couldn't link that guest.",
                        );
                        if (ok) setLinking(null);
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 7,
                        background: "var(--surface)",
                        border: "1.5px solid rgba(0,0,0,.1)",
                        borderRadius: 13,
                        padding: "6px 11px 6px 6px",
                        cursor: "pointer",
                        font: "700 12px var(--font-body)",
                        color: "var(--ink)",
                      }}
                    >
                      <span className="av" style={{ background: m.color, width: 22, height: 22, borderRadius: 7, fontSize: 9 }}>
                        {m.initials}
                      </span>
                      {m.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}

        {error && <p style={{ color: "var(--danger)", font: "600 12px var(--font-body)", margin: 0 }}>{error}</p>}

        {isAdmin &&
          (adding ? (
            <div style={{ background: "var(--surface)", border: "1px solid rgba(0,0,0,.08)", borderRadius: 14, padding: 12 }}>
              <input
                className="field"
                style={{ marginBottom: 8 }}
                placeholder="Their name, e.g. Maria"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="btnG"
                  style={{ background: "var(--chip)", color: "var(--ink)" }}
                  onClick={() => {
                    setAdding(false);
                    setNewName("");
                  }}
                >
                  Cancel
                </button>
                <button
                  className="btnP"
                  disabled={busy || !newName.trim()}
                  onClick={async () => {
                    const ok = await send(
                      `/api/groups/${groupId}/guests`,
                      "POST",
                      { displayName: newName.trim() },
                      "Couldn't add that guest.",
                    );
                    if (ok) {
                      setNewName("");
                      setAdding(false);
                    }
                  }}
                >
                  Add
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAdding(true)}
              style={{
                width: "100%",
                background: "var(--teal-soft)",
                border: "1px dashed rgba(20,184,196,.6)",
                borderRadius: 13,
                padding: 11,
                font: "800 12px var(--font-body)",
                color: "var(--teal-ink)",
                cursor: "pointer",
              }}
            >
              + Add guest
            </button>
          ))}
      </div>
    </>
  );
}
