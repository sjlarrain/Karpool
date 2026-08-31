"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Database } from "@/types/database";
import { avatarColorFor as colorFor } from "@/domain/avatarColor";
import { STOP_ICONS } from "@/domain/types";
import type { StopIcon } from "@/domain/types";
import { shareOrCopy } from "@/lib/share";
import { StopGlyph, isStopIcon } from "./StopSign";
import { readJsonBody, UNREADABLE_REPLY } from "@/lib/http/readJsonBody";

type Group = Database["public"]["Tables"]["group"]["Row"];
type PickupPlace = Database["public"]["Tables"]["pickup_place"]["Row"];

interface Props {
  group: Group;
  role: "member" | "group_admin";
  memberCount: number;
  adminName: string | null;
  pickupPlaces: PickupPlace[];
  inviteLink: string;
  otherGroups: { id: string; name: string }[];
}

export function GroupScreen({ group, role, memberCount, adminName, pickupPlaces, inviteLink, otherGroups }: Props) {
  const router = useRouter();
  // D-29: one table, two kinds. A pickup point is where a member is collected; a stop is a place
  // the whole car detours through. Keeping the lists apart is what stops "Gym" ever being offered
  // as somebody's home pickup point.
  const pickups = pickupPlaces.filter((p) => p.kind !== "stop");
  const stopPlaces = pickupPlaces.filter((p) => p.kind === "stop");
  const [sheet, setSheet] = useState<"switch" | "create" | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // The server builds the invite link from NEXT_PUBLIC_APP_URL. Once mounted, prefer the origin the
  // visitor is actually on: a stale or missing env value in a deployment would otherwise hand out
  // links pointing at the wrong host, and the person sharing has no way to notice.
  const [shareUrl, setShareUrl] = useState(inviteLink);

  useEffect(() => {
    setShareUrl(`${window.location.origin}/j/${group.code}`);
  }, [group.code]);

  function flash(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 2200);
  }

  async function signOut() {
    await fetch("/api/auth/signout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  async function copyInvite() {
    // On a phone this is a real share sheet (the PWA's whole point); everywhere else it falls back
    // to the clipboard. Shared by the ride share button in TripDetailOverlay.
    const outcome = await shareOrCopy({ title: `Join ${group.name} on Karpool`, url: shareUrl });
    if (outcome === "copied") flash("Invite link copied 🔗");
    if (outcome === "failed") flash("Couldn't copy — copy it manually");
  }

  return (
    <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div className="scroll" style={{ maxWidth: 430, margin: "0 auto", width: "100%", padding: "8px 20px 40px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0 10px" }}>
          <button
            onClick={() => setSheet("switch")}
            style={{ background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer" }}
          >
            <span style={{ font: "800 20px var(--font-display)", color: "var(--ink)" }}>
              {group.name} <span style={{ color: "rgba(0,0,0,.3)", fontSize: 15 }}>▾</span>
            </span>
          </button>
          <button className="iconbtn" onClick={signOut} title="Sign out" aria-label="Sign out">
            ⎋
          </button>
        </div>

        <div style={{ textAlign: "center", padding: "8px 0 18px" }}>
          <span
            className="av"
            style={{
              width: 72,
              height: 72,
              borderRadius: 24,
              fontSize: 26,
              margin: "8px auto 0",
              background: colorFor(group.id),
            }}
          >
            {group.name.charAt(0).toUpperCase()}
          </span>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: "var(--ink)", margin: "12px 0 2px" }}>{group.name}</h2>
          <p style={{ font: "600 12px var(--font-body)", color: "rgba(0,0,0,.45)", margin: 0 }}>
            {memberCount} member{memberCount === 1 ? "" : "s"} · {group.origin_label} → {group.dest_label}
          </p>
        </div>

        <label className="lbl" style={{ textAlign: "left" }}>
          Group details
        </label>
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--hairline)",
            borderRadius: 16,
            overflow: "hidden",
            marginBottom: 16,
            textAlign: "left",
          }}
        >
          <DetailRow icon="📍" label="Location" value={`${group.origin_label} → ${group.dest_label}`} />
          <DetailRow icon="👑" label="Administrator" value={adminName ?? "—"} />
          <DetailRow icon="💵" label="Cost split" value={group.cost_split_note ?? "Not set"} />
          <DetailRow icon="🔢" label="Group code" value={group.code} last mono />
        </div>

        <label className="lbl" style={{ textAlign: "left" }}>
          Pickup places
        </label>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
          {pickups.length === 0 && (
            <p style={{ font: "500 12px var(--font-body)", color: "rgba(0,0,0,.4)" }}>No pickup places yet.</p>
          )}
          {pickups.map((p) => (
            <div
              key={p.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 11,
                background: "var(--surface)",
                border: "1px solid rgba(0,0,0,.08)",
                borderRadius: 14,
                padding: "12px 13px",
                textAlign: "left",
              }}
            >
              <span
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 9,
                  background: "var(--purple-soft)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 15,
                  flex: "none",
                }}
              >
                📍
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ font: "800 13px var(--font-body)", color: "var(--ink)" }}>{p.label}</div>
                <div style={{ font: "600 10.5px var(--font-body)", color: "rgba(0,0,0,.45)" }}>
                  {p.address}
                  {p.typical_time ? ` — ${p.typical_time}` : ""}
                </div>
              </div>
            </div>
          ))}
          {role === "group_admin" && <AddPlace groupId={group.id} kind="pickup" onAdded={() => router.refresh()} />}
        </div>

        <label className="lbl" style={{ textAlign: "left" }}>
          Stops
        </label>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
          {stopPlaces.length === 0 && (
            <p style={{ font: "500 12px var(--font-body)", color: "rgba(0,0,0,.4)" }}>
              No stops yet. Add one and drivers can mark a trip as passing through it.
            </p>
          )}
          {stopPlaces.map((p) => (
            <div
              key={p.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 11,
                background: "var(--surface)",
                border: "1px solid rgba(0,0,0,.08)",
                borderRadius: 14,
                padding: "12px 13px",
                textAlign: "left",
              }}
            >
              <span
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 9,
                  background: "var(--amber-soft)",
                  color: "var(--amber-ink)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flex: "none",
                }}
              >
                {isStopIcon(p.icon) && <StopGlyph icon={p.icon} size={16} />}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ font: "800 13px var(--font-body)", color: "var(--ink)" }}>{p.label}</div>
                <div style={{ font: "600 10.5px var(--font-body)", color: "rgba(0,0,0,.45)" }}>{p.address}</div>
              </div>
            </div>
          ))}
          {role === "group_admin" && <AddPlace groupId={group.id} kind="stop" onAdded={() => router.refresh()} />}
        </div>

        <label className="lbl" style={{ textAlign: "left" }}>
          Invite more riders
        </label>
        <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
          <div
            className="field"
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              fontWeight: 700,
              color: "rgba(0,0,0,.55)",
              overflow: "hidden",
              whiteSpace: "nowrap",
            }}
          >
            {shareUrl}
          </div>
          <button
            onClick={copyInvite}
            style={{
              background: "var(--ink)",
              color: "var(--surface)",
              border: "none",
              borderRadius: 13,
              padding: "0 16px",
              fontWeight: 800,
              cursor: "pointer",
              flex: "none",
            }}
          >
            Share
          </button>
        </div>

        <button className="btnP" style={{ marginBottom: 10 }} onClick={() => setSheet("create")}>
          + Create a new group
        </button>
      </div>

      {sheet === "switch" && (
        <SwitchGroupSheet current={{ id: group.id, name: group.name }} others={otherGroups} onClose={() => setSheet(null)} />
      )}
      {sheet === "create" && <CreateGroupSheet onClose={() => setSheet(null)} />}
      {toast && <div className="toast" style={{ position: "fixed" }}>{toast}</div>}
    </div>
  );
}

function DetailRow({ icon, label, value, last, mono }: { icon: string; label: string; value: string; last?: boolean; mono?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "13px 14px",
        borderBottom: last ? undefined : "1px solid rgba(0,0,0,.06)",
      }}
    >
      <span style={{ fontSize: 17 }}>{icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ font: "600 10px var(--font-body)", color: "rgba(0,0,0,.4)", textTransform: "uppercase", letterSpacing: ".04em" }}>
          {label}
        </div>
        <div
          style={{
            font: mono ? "800 15px var(--font-display)" : "700 13px var(--font-body)",
            color: "var(--ink)",
            letterSpacing: mono ? ".14em" : undefined,
          }}
        >
          {value}
        </div>
      </div>
    </div>
  );
}

// D-29: one editor for both kinds of place. A stop additionally carries a sign, picked from a fixed
// set — the admin chooses it once here, and every trip through that stop shows the same mark.
function AddPlace({ groupId, kind, onAdded }: { groupId: string; kind: "pickup" | "stop"; onAdded: () => void }) {
  const isStop = kind === "stop";
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [address, setAddress] = useState("");
  const [icon, setIcon] = useState<StopIcon>("gym");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          width: "100%",
          background: isStop ? "var(--amber-soft)" : "var(--purple-soft)",
          border: `1px dashed ${isStop ? "rgba(255,176,32,.6)" : "rgba(124,92,255,.5)"}`,
          borderRadius: 13,
          padding: 11,
          font: "800 12px var(--font-body)",
          color: isStop ? "var(--amber-ink)" : "var(--purple)",
          cursor: "pointer",
        }}
      >
        {isStop ? "+ Add stop" : "+ Add pickup place"}
      </button>
    );
  }

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/groups/${groupId}/pickup-places`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, address, kind, icon: isStop ? icon : undefined }),
      });
      const body = await readJsonBody(res);
      if (!res.ok) {
        setError(body?.message ?? `Couldn't add that ${isStop ? "stop" : "pickup place"}.`);
        return;
      }
      setLabel("");
      setAddress("");
      setOpen(false);
      onAdded();
    } catch {
      setError("Couldn't reach the server — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ background: "var(--surface)", border: "1px solid rgba(0,0,0,.08)", borderRadius: 14, padding: 12 }}>
      <input
        className="field"
        style={{ marginBottom: 8 }}
        placeholder={isStop ? "e.g. Gym" : "e.g. Sepulveda"}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      <input
        className="field"
        style={{ marginBottom: 8 }}
        placeholder={isStop ? "e.g. Fitness Park, Sepulveda" : "e.g. Sepulveda & Venice"}
        value={address}
        onChange={(e) => setAddress(e.target.value)}
      />
      {isStop && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {STOP_ICONS.map((name) => (
            <button
              key={name}
              onClick={() => setIcon(name)}
              aria-label={name}
              aria-pressed={icon === name}
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                background: icon === name ? "var(--amber-soft)" : "var(--chip)",
                color: icon === name ? "var(--amber-ink)" : "rgba(0,0,0,.4)",
                border: `1.5px solid ${icon === name ? "var(--amber)" : "transparent"}`,
              }}
            >
              <StopGlyph icon={name} size={17} />
            </button>
          ))}
        </div>
      )}
      {error && <p style={{ color: "var(--danger)", font: "600 12px var(--font-body)", margin: "0 0 8px" }}>{error}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btnG" style={{ background: "var(--chip)", color: "var(--ink)" }} onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button className="btnP" disabled={busy} onClick={submit}>
          Add
        </button>
      </div>
    </div>
  );
}

function SwitchGroupSheet({
  current,
  others,
  onClose,
}: {
  current: { id: string; name: string };
  others: { id: string; name: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/groups/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body = await readJsonBody<{ group: { id: string } }>(res);
      if (!res.ok) {
        setError(body?.message ?? "That code didn't work.");
        return;
      }
      // Joined, but with no id to navigate to — say so rather than pushing to `/app?g=undefined`.
      if (!body?.group) {
        setError(UNREADABLE_REPLY);
        return;
      }
      router.push(`/app?g=${body.group.id}`);
      router.refresh();
      onClose();
    } catch {
      setError("Couldn't reach the server — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheetc" onClick={(e) => e.stopPropagation()}>
        <div style={{ width: 38, height: 4, background: "rgba(0,0,0,.15)", borderRadius: 2, margin: "0 auto 16px" }} />
        <h3 style={{ fontSize: 17, fontWeight: 800, color: "var(--ink)", margin: "0 0 12px" }}>Switch group</h3>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 11,
            background: "var(--purple-soft)",
            border: "1px solid rgba(124,92,255,.35)",
            borderRadius: 15,
            padding: 12,
            marginBottom: 9,
          }}
        >
          <span className="av" style={{ width: 38, height: 38, borderRadius: 12, background: colorFor(current.id), fontSize: 14 }}>
            {current.name.charAt(0).toUpperCase()}
          </span>
          <div style={{ flex: 1, font: "800 14px var(--font-display)", color: "var(--ink)" }}>{current.name}</div>
          <span style={{ color: "var(--purple)", fontSize: 16 }}>✓</span>
        </div>

        {others.map((g) => (
          <button
            key={g.id}
            onClick={() => {
              router.push(`/app?g=${g.id}`);
              onClose();
            }}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 11,
              background: "var(--surface)",
              border: "1px solid rgba(0,0,0,.08)",
              borderRadius: 15,
              padding: 12,
              marginBottom: 9,
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <span className="av" style={{ width: 38, height: 38, borderRadius: 12, background: colorFor(g.id), fontSize: 14 }}>
              {g.name.charAt(0).toUpperCase()}
            </span>
            <div style={{ flex: 1, font: "800 14px var(--font-display)", color: "var(--ink)" }}>{g.name}</div>
          </button>
        ))}

        <label className="lbl" style={{ marginTop: 8 }}>
          Join another group
        </label>
        {error && <p style={{ color: "var(--danger)", font: "600 12px var(--font-body)", margin: "0 0 8px" }}>{error}</p>}
        <div style={{ display: "flex", gap: 8 }}>
          <input className="field" placeholder="Enter invite code" value={code} onChange={(e) => setCode(e.target.value)} />
          <button
            onClick={join}
            disabled={busy}
            style={{ background: "var(--green)", color: "var(--surface)", border: "none", borderRadius: 13, padding: "0 18px", fontWeight: 800, cursor: "pointer" }}
          >
            Join
          </button>
        </div>
      </div>
    </div>
  );
}

export function CreateGroupSheet({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [origin, setOrigin] = useState("");
  const [dest, setDest] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, originLabel: origin, destLabel: dest }),
      });
      const body = await readJsonBody<{ group: { id: string } }>(res);
      if (!res.ok) {
        setError(body?.message ?? "Couldn't create that group.");
        return;
      }
      if (!body?.group) {
        setError(UNREADABLE_REPLY);
        return;
      }
      router.push(`/app?g=${body.group.id}`);
      router.refresh();
      onClose();
    } catch {
      setError("Couldn't reach the server — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheetc" onClick={(e) => e.stopPropagation()}>
        <div style={{ width: 38, height: 4, background: "rgba(0,0,0,.15)", borderRadius: 2, margin: "0 auto 16px" }} />
        <h3 style={{ fontSize: 17, fontWeight: 800, color: "var(--ink)", margin: "0 0 4px" }}>Create a group</h3>
        <p style={{ font: "500 12px var(--font-body)", color: "rgba(0,0,0,.45)", margin: "0 0 16px" }}>
          You&apos;ll be the admin. Set the shared route every trip will run.
        </p>
        <label className="lbl">Group name</label>
        <input className="field" style={{ marginBottom: 14 }} placeholder="e.g. South Office Pool" value={name} onChange={(e) => setName(e.target.value)} />
        <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <label className="lbl">Starts at</label>
            <input className="field" placeholder="Riverside" value={origin} onChange={(e) => setOrigin(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label className="lbl">Ends at</label>
            <input className="field" placeholder="HQ" value={dest} onChange={(e) => setDest(e.target.value)} />
          </div>
        </div>
        {error && <p style={{ color: "var(--danger)", font: "600 12px var(--font-body)", margin: "0 0 12px" }}>{error}</p>}
        <button className="btnP" disabled={busy} onClick={submit}>
          Create group
        </button>
      </div>
    </div>
  );
}
