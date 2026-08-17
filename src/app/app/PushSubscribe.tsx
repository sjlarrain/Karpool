"use client";

import { useEffect, useState } from "react";
import { clientEnv } from "@/env.client";

// Converts the VAPID public key (base64url, as issued by web-push) into the Uint8Array shape
// PushManager.subscribe's applicationServerKey expects.
function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const array = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) array[i] = raw.charCodeAt(i);
  return array;
}

type Status = "unsupported" | "checking" | "denied" | "subscribed" | "available";

export function PushSubscribe() {
  const [status, setStatus] = useState<Status>("checking");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setStatus("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setStatus("denied");
      return;
    }

    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => registration.pushManager.getSubscription())
      .then((sub) => setStatus(sub ? "subscribed" : "available"))
      .catch(() => setStatus("unsupported"));
  }, []);

  async function subscribe() {
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus("denied");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(clientEnv.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""),
      });
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!res.ok) {
        setError("Couldn't save your subscription. Try again.");
        return;
      }
      setStatus("subscribed");
    } catch {
      setError("Couldn't enable notifications on this device.");
    }
  }

  if (status === "unsupported" || status === "subscribed") return null;

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid rgba(0,0,0,.08)",
        borderRadius: 15,
        padding: 14,
        textAlign: "left",
      }}
    >
      <div style={{ font: "800 13px var(--font-body)", color: "var(--ink)", marginBottom: 4 }}>🔔 Get trip alerts</div>
      <p style={{ font: "500 11.5px var(--font-body)", color: "rgba(0,0,0,.5)", margin: "0 0 10px" }}>
        {status === "denied"
          ? "Notifications are blocked for this site — enable them in your browser settings."
          : "Know when a trip starts, changes, or closes."}
      </p>
      {error && <p style={{ color: "var(--danger)", font: "600 11px var(--font-body)", margin: "0 0 8px" }}>{error}</p>}
      {status === "available" && (
        <button className="btnP" onClick={subscribe}>
          Enable notifications
        </button>
      )}
    </div>
  );
}
