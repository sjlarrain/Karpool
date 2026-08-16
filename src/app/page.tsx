import Link from "next/link";

export default function Home() {
  return (
    <main
      style={{
        fontFamily: "var(--font-body)",
        color: "var(--ink)",
        textAlign: "center",
        padding: "40px 20px",
      }}
    >
      <h1 style={{ fontFamily: "var(--font-display)" }}>Carpool</h1>
      <p>Product screens ship in later phases. See the design primitives:</p>
      <Link href="/styleguide" style={{ fontWeight: 700 }}>
        /styleguide →
      </Link>
    </main>
  );
}
