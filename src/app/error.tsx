"use client";

import { useEffect } from "react";

// Catches render/data errors anywhere under the root layout that a route's own code didn't handle.
// Next.js requires this to be a client component with a reset() escape hatch.
export default function GlobalRouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // No dedicated client-side logger yet — surfacing to the browser console is the honest interim
    // behavior rather than silently swallowing it. Revisit if/when Phase 8 wants structured
    // client-error reporting.
    console.error(error);
  }, [error]);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 30px",
        textAlign: "center",
        background: "var(--bg)",
      }}
    >
      <div style={{ fontSize: 46 }}>⚠️</div>
      <h1 style={{ fontSize: 21, fontWeight: 800, color: "var(--ink)", margin: "16px 0 6px", fontFamily: "var(--font-display)" }}>
        Something went wrong
      </h1>
      <p style={{ font: "500 13px/1.5 var(--font-body)", color: "rgba(0,0,0,.5)", margin: "0 0 22px", maxWidth: 260 }}>
        That wasn&apos;t supposed to happen. Try again, or head back and pick up where you left off.
      </p>
      <button className="btnP" style={{ maxWidth: 220 }} onClick={reset}>
        Try again
      </button>
    </main>
  );
}
