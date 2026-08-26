import { describe, expect, it } from "vitest";
import { classifySignupError } from "./authError";

// The wordings below are Supabase's real ones, not invented — the rate-limit case is the exact
// string a real employee saw on production, which is why this file exists.
describe("classifySignupError", () => {
  it("treats the shared mailer's hourly cap as a server problem, not a bad request", () => {
    const failure = classifySignupError({ message: "email rate limit exceeded", status: 429 });
    expect(failure.status).toBe(429);
    expect(failure.error).toBe("email_send_rate_limited");
    expect(failure.message).not.toContain("rate limit"); // never the raw wording in the UI
    expect(failure.detail).toBe("email rate limit exceeded");
  });

  it("recognises the cap from the message alone, without a status", () => {
    expect(classifySignupError({ message: "Email rate limit exceeded" }).status).toBe(429);
  });

  it("recognises the cap from the error code alone", () => {
    expect(classifySignupError({ message: "over quota", code: "over_email_send_rate_limit" }).error).toBe(
      "email_send_rate_limited",
    );
  });

  it("blames the deployment, not the visitor, when the mailer refuses the address", () => {
    const failure = classifySignupError({ message: "Email address not authorized", status: 403 });
    expect(failure).toMatchObject({ status: 502, error: "email_not_authorized" });
  });

  it("reports a failed send as an upstream failure", () => {
    const failure = classifySignupError({ message: "Error sending confirmation email", status: 500 });
    expect(failure).toMatchObject({ status: 502, error: "email_delivery_failed" });
  });

  it("says so plainly when signups are switched off", () => {
    const failure = classifySignupError({ message: "Signups not allowed for this instance" });
    expect(failure).toMatchObject({ status: 403, error: "signups_disabled" });
  });

  // Seen for real: reaching for "Confirm email" and hitting the Email provider's master toggle
  // instead, which locks out existing users too and reports itself in different words.
  it("recognises the Email provider's own master switch being off", () => {
    for (const message of ["Email signups are disabled", "Email logins are disabled"]) {
      expect(classifySignupError({ message })).toMatchObject({ status: 403, error: "signups_disabled" });
    }
  });

  it("points an existing account at the sign-in tab", () => {
    const failure = classifySignupError({ message: "User already registered", status: 422 });
    expect(failure).toMatchObject({ status: 409, error: "email_taken" });
    expect(failure.message).toContain("sign in");
  });

  it("keeps a rejected address a 400 — that one really is the form's fault", () => {
    const failure = classifySignupError({ message: 'Email address "a@b.test" is invalid', status: 400 });
    expect(failure).toMatchObject({ status: 400, error: "email_invalid" });
  });

  it("passes Supabase's password wording through, since it is the specific one", () => {
    const detail = "Password should contain at least one character of each: abcdefghijklmnopqrstuvwxyz";
    const failure = classifySignupError({ message: detail, code: "weak_password" });
    expect(failure).toMatchObject({ status: 400, error: "weak_password", message: detail });
  });

  it("falls back to a 400 carrying the original message", () => {
    const failure = classifySignupError({ message: "Something nobody has seen yet" });
    expect(failure).toMatchObject({
      status: 400,
      error: "signup_failed",
      message: "Something nobody has seen yet",
    });
  });

  it("always keeps the original wording in detail", () => {
    for (const message of ["email rate limit exceeded", "Email address not authorized", "User already registered"]) {
      expect(classifySignupError({ message }).detail).toBe(message);
    }
  });
});
