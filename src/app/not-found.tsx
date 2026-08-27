import Link from "next/link";

export default function NotFound() {
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
      <div style={{ fontSize: 46 }}>🧭</div>
      <h1 style={{ fontSize: 21, fontWeight: 800, color: "var(--ink)", margin: "16px 0 6px", fontFamily: "var(--font-display)" }}>
        Page not found
      </h1>
      <p style={{ font: "500 13px/1.5 var(--font-body)", color: "rgba(0,0,0,.5)", margin: "0 0 22px", maxWidth: 260 }}>
        That page doesn&apos;t exist, or you don&apos;t have access to it.
      </p>
      <Link href="/" className="btnP" style={{ maxWidth: 220, display: "inline-block", textDecoration: "none", textAlign: "center" }}>
        Back to Karpool
      </Link>
    </main>
  );
}
