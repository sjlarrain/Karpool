"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Database } from "@/types/database";
import type { TripView } from "@/domain/types";
import { GroupScreen } from "./GroupScreen";
import { CarpoolsScreen } from "./CarpoolsScreen";
import { CreateTripOverlay } from "./CreateTripOverlay";
import { TripDetailOverlay } from "./TripDetailOverlay";
import { RanksScreen } from "./RanksScreen";
import { YouScreen } from "./YouScreen";
import { NotificationsSheet, type NotificationItem } from "./NotificationsSheet";

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
  membershipId: string;
  pickupPlaceId: string | null;
  otherGroups: { id: string; name: string }[];
  trips: TripView[];
  viewerName: string;
  initialTripId: string | null;
  isPlatformAdmin: boolean;
}

export function AppShell({ group, role, memberCount, adminName, pickupPlaces, inviteLink, membershipId, pickupPlaceId, otherGroups, trips, viewerName, initialTripId, isPlatformAdmin }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("carpools");
  const [notifsOpen, setNotifsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notifsLoading, setNotifsLoading] = useState(true);

  // The bell's unread dot has to be right on first paint, so the feed loads on mount rather than on
  // open. Opening the sheet marks everything read (POST /api/notifications/read) and clears the dot
  // locally — no refetch, the response only confirms what we already show.
  const loadNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) return;
      const body = await res.json();
      setNotifications(body.notifications as NotificationItem[]);
    } catch {
      // A failed poll leaves the last known feed in place; the bell is not worth a visible error.
    } finally {
      setNotifsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadNotifications();
  }, [loadNotifications]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  async function openNotifications() {
    setNotifsOpen(true);
    if (unreadCount === 0) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    try {
      await fetch("/api/notifications/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    } catch {
      // Marking read is best-effort; the next load re-reads the truth from the server.
    }
  }
  const [overlay, setOverlay] = useState<"create" | null>(null);
  // A ride share link (/t/:id) lands here as /app?trip=<id> — open that ride straight away.
  const [openTripId, setOpenTripId] = useState<string | null>(initialTripId);
  const [toast, setToast] = useState<string | null>(null);

  function flash(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 2200);
  }

  // Closing the overlay also drops ?trip= from the URL, so a later refresh or back-forward restore
  // doesn't reopen a ride the viewer just dismissed.
  function closeTrip() {
    setOpenTripId(null);
    const params = new URLSearchParams(window.location.search);
    if (!params.has("trip")) return;
    params.delete("trip");
    const query = params.toString();
    window.history.replaceState({}, "", query ? `/app?${query}` : "/app");
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
              <button
                className="iconbtn"
                onClick={openNotifications}
                aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
                style={{ position: "relative", background: "var(--ink)", color: "var(--surface)", border: "none" }}
              >
                🔔
                {unreadCount > 0 && (
                  <span
                    style={{
                      position: "absolute",
                      top: 8,
                      right: 9,
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: "var(--coral)",
                      border: "2px solid var(--ink)",
                    }}
                  />
                )}
              </button>
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
            <YouScreen
              viewerName={viewerName}
              groupName={group.name}
              memberCount={memberCount}
              membershipId={membershipId}
              pickupPlaces={pickupPlaces}
              pickupPlaceId={pickupPlaceId}
              isPlatformAdmin={isPlatformAdmin}
              onOpenGroup={() => setTab("group")}
            />
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
          onClose={closeTrip}
          onChanged={(message) => {
            flash(message);
            router.refresh();
          }}
        />
      )}

      {notifsOpen && (
        <NotificationsSheet
          notifications={notifications}
          loading={notifsLoading}
          onClose={() => setNotifsOpen(false)}
          onOpenTrip={(tripId) => {
            setNotifsOpen(false);
            setOpenTripId(tripId);
          }}
        />
      )}

      {toast && <div className="toast" style={{ position: "fixed" }}>{toast}</div>}
    </main>
  );
}
