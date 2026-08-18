"use client";

import { useState } from "react";
import Link from "next/link";
import { AdminOverviewTab } from "./AdminOverviewTab";
import { AdminUsersTab } from "./AdminUsersTab";
import { AdminGroupsTab } from "./AdminGroupsTab";
import { AdminTripsTab } from "./AdminTripsTab";
import { AdminLedgerTab } from "./AdminLedgerTab";
import { AdminAuditLogTab } from "./AdminAuditLogTab";
import { AdminHealthTab } from "./AdminHealthTab";

type Tab = "overview" | "users" | "groups" | "trips" | "ledger" | "audit" | "health";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "users", label: "Users" },
  { id: "groups", label: "Groups" },
  { id: "trips", label: "Trips" },
  { id: "ledger", label: "Ledger" },
  { id: "audit", label: "Audit log" },
  { id: "health", label: "Health" },
];

export function AdminShell({ adminName }: { adminName: string }) {
  const [tab, setTab] = useState<Tab>("overview");

  return (
    <main style={{ minHeight: "100vh", background: "var(--page)" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 20px 60px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <div>
            <h1 style={{ font: "800 24px var(--font-display)", color: "var(--ink)", margin: 0 }}>Admin console</h1>
            <p style={{ font: "600 12px var(--font-body)", color: "rgba(0,0,0,.45)", margin: "2px 0 0" }}>Signed in as {adminName}</p>
          </div>
          <Link href="/app" style={{ font: "700 12.5px var(--font-body)", color: "var(--link)" }}>
            ← Back to app
          </Link>
        </div>

        <div className="seg" style={{ marginBottom: 20, overflowX: "auto" }}>
          {TABS.map((t) => (
            <button key={t.id} className={`segb ${tab === t.id ? "on" : ""}`} onClick={() => setTab(t.id)} style={{ minWidth: 90 }}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === "overview" && <AdminOverviewTab />}
        {tab === "users" && <AdminUsersTab />}
        {tab === "groups" && <AdminGroupsTab />}
        {tab === "trips" && <AdminTripsTab />}
        {tab === "ledger" && <AdminLedgerTab />}
        {tab === "audit" && <AdminAuditLogTab />}
        {tab === "health" && <AdminHealthTab />}
      </div>
    </main>
  );
}
