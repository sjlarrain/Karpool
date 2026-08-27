"use client";

import "./globals.css";

// Only fires for errors thrown by the root layout itself (rare — error.tsx below the layout
// catches everything else). Next.js requires this to render its own <html>/<body>.
export default function GlobalLayoutError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body>
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
            Karpool hit a snag
          </h1>
          <p style={{ font: "500 13px/1.5 var(--font-body)", color: "rgba(0,0,0,.5)", margin: "0 0 22px", maxWidth: 260 }}>
            Reloading usually fixes it.
          </p>
          <button className="btnP" style={{ maxWidth: 220 }} onClick={reset}>
            Reload
          </button>
        </main>
      </body>
    </html>
  );
}
