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

// Does an existing browser subscription still belong to the key this deployment signs with? A
// subscription minted under a rotated-away VAPID key is not dead — the browser keeps it and
// getSubscription() keeps returning it — but every push against it is refused by the push service
// with a 403, which is not one of the 404/410 codes that prune a row. Left alone it is a
// permanently silent subscription that looks perfectly healthy from both ends.
function matchesServerKey(subscription: PushSubscription, serverKey: Uint8Array): boolean {
  const applied = subscription.options?.applicationServerKey;
  if (!applied) return false;
  const current = new Uint8Array(applied);
  if (current.length !== serverKey.length) return false;
  return current.every((byte, i) => byte === serverKey[i]);
}

async function persist(subscription: PushSubscription): Promise<boolean> {
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription.toJSON()),
  });
  return res.ok;
}

type Status = "unsupported" | "checking" | "denied" | "subscribed" | "available";

export function PushSubscribe() {
  const [status, setStatus] = useState<Status>("checking");
  const [error, setError] = useState<string | null>(null);

  // Re-registering the browser's existing subscription with the server on every visit is the point
  // of this effect, not a redundancy. Push delivery needs the endpoint to exist in *two* places —
  // the browser and push_subscription — and only the browser's half is durable. The server's half
  // is deleted whenever a push comes back 404/410 (a transient outage from the push service reads
  // the same as an uninstall), and disappears entirely on any environment rebuild. The old code
  // asked the browser "are you subscribed?", got yes, and rendered nothing: the prompt was gone, so
  // there was no way left to re-register, and the user went on believing notifications were on
  // while the server had no address to send them to. Nothing about that state was visible to
  // either side. An upsert keyed on endpoint makes re-sending it free, so it is sent every time.
  useEffect(() => {
    let cancelled = false;

    async function sync() {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        if (!cancelled) setStatus("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        if (!cancelled) setStatus("denied");
        return;
      }

      try {
        const registration = await navigator.serviceWorker.register("/sw.js");
        const existing = await registration.pushManager.getSubscription();
        if (!existing) {
          if (!cancelled) setStatus("available");
          return;
        }

        const serverKey = urlBase64ToUint8Array(clientEnv.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "");
        if (serverKey.length > 0 && !matchesServerKey(existing, serverKey)) {
          // Stale key: drop it and mint a new one. Permission is already granted, so this needs no
          // prompt and the user sees nothing.
          await existing.unsubscribe();
          const replacement = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: serverKey,
          });
          const saved = await persist(replacement);
          if (!cancelled) setStatus(saved ? "subscribed" : "available");
          return;
        }

        const saved = await persist(existing);
        // A rejected re-register leaves the prompt on screen rather than a silent dead end, so the
        // user has something to press and the failure is at least visible.
        if (!cancelled) setStatus(saved ? "subscribed" : "available");
      } catch {
        if (!cancelled) setStatus("unsupported");
      }
    }

    void sync();
    return () => {
      cancelled = true;
    };
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
      const serverKey = urlBase64ToUint8Array(clientEnv.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "");
      // subscribe() throws InvalidStateError if a subscription under a different key is still on
      // file, so clear it first rather than surfacing that as "couldn't enable notifications".
      const existing = await registration.pushManager.getSubscription();
      if (existing && !matchesServerKey(existing, serverKey)) await existing.unsubscribe();

      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: serverKey }));

      if (!(await persist(subscription))) {
        setError("Couldn't save your subscription. Try again.");
        return;
      }
      setStatus("subscribed");
    } catch {
      setError("Couldn't enable notifications on this device.");
    }
  }

  if (status === "unsupported" || status === "subscribed" || status === "checking") return null;

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
