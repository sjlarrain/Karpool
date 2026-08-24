"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Ported from the sketch's AUTH block: a two-step signup (credentials, then group code) and a
// sign-in toggle, using the same primitives as /styleguide.

type Mode = "signin" | "signup";
type SignupStep = 1 | 2;

export function AuthGate({
  presetCode,
  hideHero = false,
  initialNotice,
}: { presetCode?: string; hideHero?: boolean; initialNotice?: string } = {}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [signupStep, setSignupStep] = useState<SignupStep>(1);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  // /j/:code arrives with the invite code already known — prefill it so an invited visitor never
  // retypes what they just clicked.
  const [code, setCode] = useState(presetCode ?? "");
  const [error, setError] = useState<string | null>(null);
  // /auth/callback bounces a dead confirmation link back to the auth screen with an explanation.
  const [notice, setNotice] = useState<string | null>(initialNotice ?? null);
  const [busy, setBusy] = useState(false);

  async function submitStep1() {
    setError(null);
    setBusy(true);
    try {
      if (mode === "signup") {
        const res = await fetch("/api/auth/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // The invite code, when there is one, rides along so it survives the email round trip.
          body: JSON.stringify({ email, password, displayName: name, groupCode: code || undefined }),
        });
        const body = await res.json();
        if (!res.ok) {
          setError(body.message ?? "Couldn't create your account.");
          return;
        }
        if (body.needsEmailConfirmation) {
          setNotice(
            code
              ? "Check your email to confirm your account — the link brings you straight into the group."
              : "Check your email to confirm your account — the link signs you in.",
          );
          setMode("signin");
          return;
        }
        setSignupStep(2);
      } else {
        const res = await fetch("/api/auth/signin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const body = await res.json();
        if (!res.ok) {
          setError(body.message ?? "Couldn't sign in.");
          return;
        }
        router.refresh();
      }
    } catch {
      setError("Couldn't reach the server — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function submitCode() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/groups/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.message ?? "That code didn't work.");
        return;
      }
      router.refresh();
    } catch {
      setError("Couldn't reach the server — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function skipCode() {
    router.refresh();
  }

  const firstName = name.trim().split(" ")[0] || "there";

  if (mode === "signup" && signupStep === 2) {
    return (
      <div style={{ padding: "26px 24px" }}>
        <button className="iconbtn" style={{ marginTop: 18 }} onClick={() => setSignupStep(1)} aria-label="Back">
          ←
        </button>
        <div style={{ fontSize: 40, margin: "24px 0 0" }}>🔑</div>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: "var(--ink)", margin: "14px 0 6px", lineHeight: 1.1 }}>
          Enter your
          <br />
          group code
        </h1>
        <p style={{ font: "500 13.5px/1.5 var(--font-body)", color: "rgba(0,0,0,.5)", margin: "0 0 24px" }}>
          One more step, {firstName}. A code connects you to your workplace carpool group.
        </p>
        <label className="lbl">Group code</label>
        <input
          className="field"
          placeholder="6-digit invite code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        {error && <p style={{ color: "var(--danger)", font: "600 12px var(--font-body)", margin: "8px 2px 0" }}>{error}</p>}
        <button className="btnP" style={{ marginTop: 18 }} disabled={busy} onClick={submitCode}>
          Join group &amp; finish
        </button>
        <p style={{ textAlign: "center", margin: "14px 0 0" }}>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              skipCode();
            }}
            style={{ font: "600 12px var(--font-body)", color: "rgba(0,0,0,.4)", textDecoration: "none" }}
          >
            I don&apos;t have a code yet →
          </a>
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: "26px 24px" }}>
      {/* An invite page (/j/:code) already leads with its own hero naming the group, so the generic
          pitch would just repeat a second car and headline below it. */}
      {!hideHero && (
        <>
          <div
            style={{
              width: 60,
              height: 60,
              borderRadius: 19,
              background: "linear-gradient(135deg, var(--green), var(--cyan))",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 30,
              boxShadow: "0 10px 24px rgba(23,201,100,.35)",
            }}
          >
            🚗
          </div>
          <h1 style={{ fontSize: 30, fontWeight: 800, color: "var(--ink)", margin: "22px 0 6px", lineHeight: 1.05 }}>
            Ride together,
            <br />
            rank higher.
          </h1>
          <p style={{ font: "500 13.5px/1.5 var(--font-body)", color: "rgba(0,0,0,.5)", margin: "0 0 26px" }}>
            Join your workplace carpool group to see rides, offer trips, and climb the leaderboard.
          </p>
        </>
      )}

      {notice && (
        <p
          style={{
            background: "var(--green-soft)",
            color: "var(--green-ink)",
            font: "600 12.5px var(--font-body)",
            padding: "11px 12px",
            borderRadius: 13,
            margin: "0 0 16px",
          }}
        >
          {notice}
        </p>
      )}

      <div className="seg" style={{ marginBottom: 20 }}>
        <button className={`segb ${mode === "signin" ? "on" : ""}`} onClick={() => setMode("signin")}>
          Sign in
        </button>
        <button className={`segb ${mode === "signup" ? "on" : ""}`} onClick={() => setMode("signup")}>
          Sign up
        </button>
      </div>

      <label className="lbl">Email</label>
      <input
        className="field"
        style={{ marginBottom: 16 }}
        type="email"
        placeholder="you@company.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      {mode === "signup" && (
        <>
          <label className="lbl">Username</label>
          <input
            className="field"
            style={{ marginBottom: 16 }}
            placeholder="e.g. Alex Morgan"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </>
      )}

      <label className="lbl">Password</label>
      <input
        className="field"
        style={{ marginBottom: 16 }}
        type="password"
        placeholder="••••••••"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />

      {error && <p style={{ color: "var(--danger)", font: "600 12px var(--font-body)", margin: "0 0 8px" }}>{error}</p>}

      <button className="btnP" style={{ marginTop: 14 }} disabled={busy} onClick={submitStep1}>
        {mode === "signup" ? "Continue" : "Sign in"}
      </button>
      <p style={{ textAlign: "center", margin: "16px 0 0" }}>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setMode(mode === "signin" ? "signup" : "signin");
          }}
          style={{ font: "600 12.5px var(--font-body)", textDecoration: "none" }}
        >
          {mode === "signup" ? "Have an account? Sign in" : "New here? Create account"}
        </a>
      </p>
    </div>
  );
}
