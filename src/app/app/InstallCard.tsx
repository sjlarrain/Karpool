"use client";

import { useEffect, useState } from "react";
import { detectDevice, installGuideFor, type DeviceGuess } from "@/domain/installPlatform";

// Replaces the old iPhone-only text prompt. Three jobs, in the order the developer asked for them:
// recognise the device, offer an ⓘ with real instructions for it, and — where the browser actually
// allows it — install the app directly instead of explaining how.
//
// The direct install is `beforeinstallprompt`, which only Chromium fires (Android Chrome/Edge/
// Samsung, desktop Chrome/Edge). iOS exposes no install API of any kind, so there the ⓘ steps are
// the whole feature, not a fallback. The event fires once, early, and can only be replayed by
// holding onto it — hence capturing it on mount.

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function InstallCard() {
  const [device, setDevice] = useState<DeviceGuess | null>(null);
  const [installed, setInstalled] = useState(false);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDevice(detectDevice(navigator.userAgent, navigator.maxTouchPoints));
    setInstalled(
      window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true,
    );

    function capture(event: Event) {
      // Suppress Chrome's own mini-infobar so the install happens on our button, in context,
      // rather than in a banner the visitor has already learned to dismiss.
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    }
    function onInstalled() {
      setInstalled(true);
      setDeferred(null);
    }

    window.addEventListener("beforeinstallprompt", capture);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", capture);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function install() {
    if (!deferred) return;
    setBusy(true);
    try {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      // A prompt can only be shown once per captured event; Chrome fires a fresh one later if the
      // visitor declined, so drop this one either way.
      setDeferred(null);
      if (outcome === "accepted") setInstalled(true);
    } finally {
      setBusy(false);
    }
  }

  // Server render and first paint have no navigator — render nothing rather than guess a device.
  if (!device) return null;

  if (installed) {
    return (
      <div
        style={{
          background: "var(--teal-soft)",
          border: "1px solid rgba(20,184,196,.3)",
          borderRadius: 15,
          padding: "12px 14px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          textAlign: "left",
          marginBottom: 10,
        }}
      >
        <span style={{ fontSize: 18 }}>✓</span>
        <div style={{ font: "700 12px var(--font-body)", color: "var(--ink)" }}>
          Karpool is installed on your {device.deviceLabel}
        </div>
      </div>
    );
  }

  const guide = installGuideFor(device.platform);

  return (
    <>
      <div
        style={{
          background: "var(--purple-soft)",
          border: "1px solid rgba(124,92,255,.3)",
          borderRadius: 15,
          padding: 14,
          textAlign: "left",
          marginBottom: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <span style={{ fontSize: 20 }}>📲</span>
          <div style={{ flex: 1 }}>
            <div style={{ font: "800 13px var(--font-body)", color: "var(--ink)", marginBottom: 3 }}>
              Install Karpool
            </div>
            <p style={{ font: "500 11.5px/1.45 var(--font-body)", color: "rgba(0,0,0,.55)", margin: 0 }}>
              You&apos;re on {device.deviceLabel}
              {/* Only promise one-tap when the browser has actually handed us a prompt to fire.
                  Chromium withholds beforeinstallprompt when its own install criteria aren't met
                  (and never fires it at all over plain http), so "canPromptInstall" alone would
                  advertise a button that isn't on the card. */}
              {deferred ? " — one tap and it opens like a normal app." : ". It takes three taps; the ⓘ has them."}
            </p>
          </div>
          <button
            onClick={() => setGuideOpen(true)}
            aria-label="How to install"
            style={{
              background: "var(--surface)",
              border: "1px solid rgba(0,0,0,.08)",
              borderRadius: 999,
              width: 26,
              height: 26,
              flex: "none",
              cursor: "pointer",
              font: "800 13px var(--font-body)",
              color: "var(--purple)",
              lineHeight: 1,
            }}
          >
            ⓘ
          </button>
        </div>

        {deferred && (
          <button className="btnP" style={{ marginTop: 12 }} disabled={busy} onClick={install}>
            {busy ? "Installing…" : "Install app"}
          </button>
        )}
      </div>

      {guideOpen && (
        <div className="sheet" onClick={() => setGuideOpen(false)}>
          <div className="sheetc" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ font: "800 17px var(--font-display)", color: "var(--ink)", margin: "0 0 4px", textAlign: "left" }}>
              {guide.title}
            </h3>
            <p style={{ font: "600 11px var(--font-body)", color: "rgba(0,0,0,.45)", margin: "0 0 14px", textAlign: "left" }}>
              Steps for {device.deviceLabel}
            </p>
            <ol style={{ margin: 0, padding: 0, listStyle: "none", textAlign: "left" }}>
              {guide.steps.map((step, i) => (
                <li key={i} style={{ display: "flex", gap: 10, marginBottom: 10 }}>
                  <span
                    style={{
                      flex: "none",
                      width: 22,
                      height: 22,
                      borderRadius: 999,
                      background: "var(--purple)",
                      color: "var(--surface)",
                      font: "800 11px var(--font-body)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {i + 1}
                  </span>
                  <span style={{ font: "500 12.5px/1.45 var(--font-body)", color: "var(--ink)" }}>{step}</span>
                </li>
              ))}
            </ol>
            {guide.note && (
              <p
                style={{
                  font: "500 11px/1.45 var(--font-body)",
                  color: "rgba(0,0,0,.5)",
                  background: "var(--chip)",
                  borderRadius: 12,
                  padding: 10,
                  margin: "4px 0 0",
                  textAlign: "left",
                }}
              >
                {guide.note}
              </p>
            )}
            <button className="btnG" style={{ marginTop: 14 }} onClick={() => setGuideOpen(false)}>
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}
