"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Database } from "@/types/database";
import type { TripView } from "@/domain/types";
import { GroupScreen } from "./GroupScreen";
import { CarpoolsScreen } from "./CarpoolsScreen";
import { CreateTripOverlay } from "./CreateTripOverlay";
import { TripDetailOverlay } from "./TripDetailOverlay";
import { PushSubscribe } from "./PushSubscribe";
import { IosInstallPrompt } from "./IosInstallPrompt";
import { RanksScreen } from "./RanksScreen";

type Group = Database["public"]["Tables"]["group"]["Row"];
type PickupPlace = Database["public"]["Tables"]["pickup_place"]["Row"];

type Tab = "carpools" | "ranks" | "group" | "you";

interface Props {
  group: Group;
  role: "member" | "group_admin";
  memberCount: number;
  adminName: string | null;
  pickupPlaces: PickupPlace[];
  inviteLink: string;
  otherGroups: { id: string; name: string }[];
  trips: TripView[];
  viewerName: string;
  isPlatformAdmin: boolean;
}

export function AppShell({ group, role, memberCount, adminName, pickupPlaces, inviteLink, otherGroups, trips, viewerName, isPlatformAdmin }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("carpools");
  const [overlay, setOverlay] = useState<"create" | null>(null);
  const [openTripId, setOpenTripId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function flash(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 2200);
  }

  async function quickJoin(tripId: string) {
    try {
      const res = await fetch(`/api/trips/${tripId}/join`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        flash(body.message ?? (body.error === "full" ? "That trip just filled up." : "Couldn't join that trip."));
        return;
      }
      flash("Joined — added to your trips 🎉");
      router.refresh();
    } catch {
      flash("Couldn't reach the server — check your connection and try again.");
    }
  }

  const tabButton = (id: Tab, icon: string, label: string) => (
    <button className={`tab ${tab === id ? "on" : ""}`} onClick={() => setTab(id)}>
      <span className="i">{icon}</span>
      {label}
    </button>
  );

  return (
    <main style={{ minHeight: "100vh", position: "relative", display: "flex", flexDirection: "column" }}>
      <div style={{ maxWidth: 430, margin: "0 auto", width: "100%", flex: 1, display: "flex", flexDirection: "column" }}>
        {tab !== "group" && (
          <div style={{ padding: "16px 20px 10px", flex: "none" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <button
                  onClick={() => setTab("group")}
                  style={{ background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer" }}
                >
                  <span style={{ font: "800 22px var(--font-display)", color: "var(--ink)" }}>
                    {group.name} <span style={{ color: "rgba(0,0,0,.3)", fontSize: 15 }}>▾</span>
                  </span>
                </button>
                <div style={{ font: "600 11px var(--font-body)", color: "rgba(0,0,0,.45)", marginTop: 2 }}>
                  {group.origin_label} → {group.dest_label}
                </div>
              </div>
            </div>
          </div>
        )}

        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          {tab === "carpools" && (
            <CarpoolsScreen
              trips={trips}
              onOpenTrip={(id) => setOpenTripId(id)}
              onQuickJoin={quickJoin}
            />
          )}
          {tab === "ranks" && <RanksScreen groupId={group.id} />}
          {tab === "group" && (
            <GroupScreen
              group={group}
              role={role}
              memberCount={memberCount}
              adminName={adminName}
              pickupPlaces={pickupPlaces}
              inviteLink={inviteLink}
              otherGroups={otherGroups}
            />
          )}
          {tab === "you" && (
            <div style={{ flex: 1, padding: "24px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ textAlign: "center", marginBottom: 4 }}>
                <div style={{ fontSize: 40 }}>👤</div>
                <h2 style={{ fontSize: 19, fontWeight: 800, color: "var(--ink)", margin: "12px 0 4px" }}>{viewerName}</h2>
                <p style={{ font: "500 12.5px var(--font-body)", color: "rgba(0,0,0,.45)", margin: 0 }}>
                  Your stats show up once trips start closing.
                </p>
              </div>
              <IosInstallPrompt />
              <PushSubscribe />
              {isPlatformAdmin && (
                <Link href="/admin" className="btnG" style={{ textAlign: "center", textDecoration: "none" }}>
                  Admin console
                </Link>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="tabbar">
        {tabButton("carpools", "🚗", "Carpools")}
        {tabButton("ranks", "🏆", "Ranks")}
        <button className="fab" onClick={() => setOverlay("create")}>
          +
        </button>
        {tabButton("group", "👥", "Group")}
        {tabButton("you", "👤", "You")}
      </div>

      {overlay === "create" && (
        <CreateTripOverlay
          groupId={group.id}
          groupName={group.name}
          originLabel={group.origin_label}
          destLabel={group.dest_label}
          onClose={() => setOverlay(null)}
          onCreated={() => {
            setOverlay(null);
            flash(`Trip published to ${group.name} ✨`);
            router.refresh();
          }}
        />
      )}

      {openTripId && (
        <TripDetailOverlay
          tripId={openTripId}
          onClose={() => setOpenTripId(null)}
          onChanged={(message) => {
            flash(message);
            router.refresh();
          }}
        />
      )}

      {toast && <div className="toast" style={{ position: "fixed" }}>{toast}</div>}
    </main>
  );
}
