"use client";

import { useEffect, useState } from "react";

const DISMISSED_KEY = "carpool:ios-install-dismissed";

// iOS push only works in standalone mode (added to the home screen) on iOS 16.4+ — a user who only
// ever opens Safari tabs will never receive a push, no workaround, per
// docs/Carpool_App_Infrastructure_Plan_1.md §4. This nudges them toward the one thing that fixes it.
export function IosInstallPrompt() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const dismissed = localStorage.getItem(DISMISSED_KEY) === "1";
    setShow(isIOS && !isStandalone && !dismissed);
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, "1");
    setShow(false);
  }

  if (!show) return null;

  return (
    <div
      style={{
        background: "var(--purple-soft)",
        border: "1px solid rgba(124,92,255,.3)",
        borderRadius: 15,
        padding: 14,
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        textAlign: "left",
      }}
    >
      <span style={{ fontSize: 20 }}>📲</span>
      <div style={{ flex: 1 }}>
        <div style={{ font: "800 13px var(--font-body)", color: "var(--ink)", marginBottom: 3 }}>
          Add Carpool to your Home Screen
        </div>
        <p style={{ font: "500 11.5px var(--font-body)", color: "rgba(0,0,0,.55)", margin: 0 }}>
          iPhone notifications only work once it&apos;s added — tap <b>Share</b>, then <b>Add to Home Screen</b>.
        </p>
      </div>
      <button
        onClick={dismiss}
        style={{ background: "none", border: "none", color: "rgba(0,0,0,.35)", fontSize: 13, cursor: "pointer", padding: 2 }}
      >
        ✕
      </button>
    </div>
  );
}
