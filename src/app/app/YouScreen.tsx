"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Database } from "@/types/database";
import { avatarColorFor } from "@/domain/avatarColor";
import { initialsFor } from "@/domain/initials";
import { CreateGroupSheet } from "./GroupScreen";
import { FeedbackSheet } from "./FeedbackSheet";
import { InstallCard } from "./InstallCard";
import { PushSubscribe } from "./PushSubscribe";

type PickupPlace = Database["public"]["Tables"]["pickup_place"]["Row"];

// The sketch's YOU tab. Everything here existed as data or API already — /api/me/points has
// returned these three totals since Phase 4, and PATCH /api/memberships/:id has accepted a
// pickupPlaceId since Phase 2 — but the tab rendered a placeholder line instead, so the numbers
// were invisible and a member had no way anywhere in the app to say where they get picked up.

type Stats = { driven: number; pooled: number; kudos: number; points: number; stopsThisMonth: number };

interface Props {
  viewerName: string;
  groupId: string;
  groupName: string;
  memberCount: number;
  membershipId: string;
  pickupPlaces: PickupPlace[];
  pickupPlaceId: string | null;
  isPlatformAdmin: boolean;
  onOpenGroup: () => void;
}

export function YouScreen({
  viewerName,
  groupId,
  groupName,
  memberCount,
  membershipId,
  pickupPlaces,
  pickupPlaceId,
  isPlatformAdmin,
  onOpenGroup,
}: Props) {
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [pickup, setPickup] = useState<string | null>(pickupPlaceId);
  const [savingPickup, setSavingPickup] = useState(false);
  const [sheet, setSheet] = useState<"create" | "feedback" | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/me/points")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("points request failed"))))
      .then((body: Stats) => {
        if (!cancelled) setStats(body);
      })
      .catch(() => {
        // Stats are a nice-to-have on this screen; a failure shows zeros rather than an error wall.
        if (!cancelled) setStats({ driven: 0, pooled: 0, kudos: 0, points: 0, stopsThisMonth: 0 });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function flash(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 2200);
  }

  async function choosePickup(placeId: string) {
    // Tapping the already-selected place clears it — otherwise there's no way back to "no pickup
    // point set" once one is chosen.
    const next = pickup === placeId ? null : placeId;
    const previous = pickup;
    setPickup(next);
    setSavingPickup(true);
    try {
      const res = await fetch(`/api/memberships/${membershipId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pickupPlaceId: next }),
      });
      if (!res.ok) {
        setPickup(previous);
        flash("Couldn't save your pickup point");
        return;
      }
      router.refresh();
    } catch {
      setPickup(previous);
      flash("Couldn't reach the server — try again");
    } finally {
      setSavingPickup(false);
    }
  }

  async function signOut() {
    await fetch("/api/auth/signout", { method: "POST" });
    router.push("/");
    router.refresh();
  }

  const tile = (value: number, label: string, color: string) => (
    <div style={{ flex: 1, background: "var(--surface)", border: "1px solid var(--hairline)", borderRadius: 15, padding: 14 }}>
      <div style={{ font: "800 22px var(--font-display)", color }}>{value}</div>
      <div style={{ font: "600 10px var(--font-body)", color: "rgba(0,0,0,.5)" }}>{label}</div>
    </div>
  );

  return (
    <div className="scroll" style={{ padding: "8px 20px 18px", textAlign: "center" }}>
      <span
        className="av"
        style={{
          width: 72,
          height: 72,
          borderRadius: 24,
          fontSize: 26,
          margin: "8px auto 0",
          background: avatarColorFor(viewerName),
        }}
      >
        {initialsFor(viewerName)}
      </span>
      <h2 style={{ fontSize: 20, fontWeight: 800, color: "var(--ink)", margin: "12px 0 2px" }}>{viewerName}</h2>
      <p style={{ font: "600 12px var(--font-body)", color: "rgba(0,0,0,.45)", margin: "0 0 18px" }}>
        {groupName} · {memberCount} {memberCount === 1 ? "member" : "members"}
      </p>

      <button
        onClick={onOpenGroup}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 12,
          background: "var(--purple-soft)",
          border: "1px solid rgba(124,92,255,.3)",
          borderRadius: 15,
          padding: "12px 13px",
          margin: "0 0 14px",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span className="av" style={{ width: 38, height: 38, borderRadius: 12, background: "var(--purple)", fontSize: 14 }}>
          {groupName.trim().charAt(0).toUpperCase() || "?"}
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ font: "800 14px var(--font-display)", color: "var(--ink)" }}>{groupName}</div>
          <div style={{ font: "600 11px var(--font-body)", color: "rgba(0,0,0,.45)" }}>
            Group profile · location, code, prices
          </div>
        </div>
        <span style={{ color: "rgba(0,0,0,.3)", fontSize: 15 }}>→</span>
      </button>

      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--hairline)",
          borderRadius: 16,
          padding: 14,
          marginBottom: 14,
          textAlign: "left",
        }}
      >
        <label className="lbl">Your pickup neighborhood</label>
        {pickupPlaces.length === 0 ? (
          <p style={{ font: "500 11.5px var(--font-body)", color: "rgba(0,0,0,.45)", margin: "6px 2px 0" }}>
            This group has no pickup points yet — a group admin can add them from the Group tab.
          </p>
        ) : (
          <>
            <div className="seg">
              {pickupPlaces
                .filter((place) => place.kind !== "stop")
                .map((place) => (
                <button
                  key={place.id}
                  className={`segb ${pickup === place.id ? "on" : ""}`}
                  disabled={savingPickup}
                  onClick={() => choosePickup(place.id)}
                >
                  {place.label}
                </button>
                ))}
            </div>
            <p style={{ font: "500 10.5px var(--font-body)", color: "rgba(0,0,0,.4)", margin: "9px 2px 0" }}>
              Drivers&apos; route maps use this to plot your pickup stop.
            </p>
          </>
        )}
      </div>

      <div style={{ display: "flex", gap: 9, marginBottom: 10 }}>
        {tile(stats?.driven ?? 0, "Trips driven", "var(--purple)")}
        {tile(stats?.pooled ?? 0, "People pooled", "var(--teal)")}
        {tile(stats?.kudos ?? 0, "Kudos earned", "var(--green)")}
      </div>

      {/* D-29: the motivation counter. Scores nothing — it just makes the habit visible. */}
      {(stats?.stopsThisMonth ?? 0) > 0 && (
        <div style={{ display: "flex", gap: 9, marginBottom: 10 }}>
          {tile(stats?.stopsThisMonth ?? 0, "Stops this month", "var(--amber)")}
        </div>
      )}

      <InstallCard />
      <PushSubscribe />

      {isPlatformAdmin && (
        <Link
          href="/admin"
          className="btnG"
          style={{ display: "block", textAlign: "center", textDecoration: "none", marginTop: 10 }}
        >
          Admin console
        </Link>
      )}

      <button
        onClick={() => setSheet("feedback")}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 12,
          background: "var(--surface)",
          border: "1px solid var(--hairline)",
          borderRadius: 16,
          padding: "13px 14px",
          marginTop: 10,
          marginBottom: 10,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span style={{ fontSize: 18 }}>💬</span>
        <div style={{ flex: 1 }}>
          <div style={{ font: "800 14px var(--font-display)", color: "var(--ink)" }}>Send feedback</div>
          <div style={{ font: "600 11px var(--font-body)", color: "rgba(0,0,0,.45)" }}>
            A bug, an idea, or anything that annoys you
          </div>
        </div>
        <span style={{ color: "rgba(0,0,0,.3)", fontSize: 15 }}>→</span>
      </button>

      <button className="btnP" style={{ marginBottom: 10 }} onClick={() => setSheet("create")}>
        + Create a new group
      </button>
      <button className="btnG" onClick={signOut}>
        Switch group / sign out
      </button>

      {sheet === "create" && <CreateGroupSheet onClose={() => setSheet(null)} />}
      {sheet === "feedback" && (
        <FeedbackSheet
          groupId={groupId}
          onClose={() => setSheet(null)}
          onSent={(message) => {
            setSheet(null);
            setToast(message);
            setTimeout(() => setToast(null), 2600);
          }}
        />
      )}
      {toast && <div className="toast" style={{ position: "fixed" }}>{toast}</div>}
    </div>
  );
}
