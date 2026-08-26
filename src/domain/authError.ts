// Every Supabase signup failure arrives in one shape — a message, sometimes a status — and the
// route used to answer all of them with a flat `400 signup_failed` carrying Supabase's own wording
// straight through to the form. That is how a project-wide mail problem came to look like a user
// typo: someone signing up saw "email rate limit exceeded" in red under their password, which reads
// as *their* mistake and is really ours. A 400 also tells the browser, the logs and any future
// monitoring that the request was malformed, when nothing about it was.
//
// Pure on purpose: the classification is the part worth testing, and it depends only on strings.

export type SignupFailureCode =
  | "email_send_rate_limited"
  | "email_not_authorized"
  | "email_delivery_failed"
  | "email_invalid"
  | "email_taken"
  | "signups_disabled"
  | "weak_password"
  | "signup_failed";

export type SignupFailure = {
  status: number;
  error: SignupFailureCode;
  /** What the person who just filled in the form should read. */
  message: string;
  /** Supabase's own wording, kept for logs and debugging — never the only thing the UI shows. */
  detail: string;
};

/** The parts of `@supabase/supabase-js`'s `AuthError` this needs, so tests need no fixtures. */
export type SupabaseAuthErrorLike = {
  message: string;
  status?: number;
  code?: string;
};

export function classifySignupError(error: SupabaseAuthErrorLike): SignupFailure {
  const detail = error.message;
  const text = detail.toLowerCase();
  const code = error.code ?? "";

  // Supabase's built-in mailer sends two messages an hour for the *whole project*, so one signup
  // can lock everyone else out for the rest of the hour. 429, not 400: the request was fine.
  if (code === "over_email_send_rate_limit" || error.status === 429 || text.includes("rate limit")) {
    return {
      status: 429,
      error: "email_send_rate_limited",
      message: "Too many confirmation emails have gone out in the last hour. Please try again shortly.",
      detail,
    };
  }

  // The built-in mailer only delivers to the Supabase project's own team members. Everyone else is
  // refused — which is a deployment problem, never anything the person signing up can fix.
  if (code === "email_address_not_authorized" || text.includes("not authorized")) {
    return {
      status: 502,
      error: "email_not_authorized",
      message: "We couldn't send your confirmation email. That's on us — please tell whoever set up this app.",
      detail,
    };
  }

  if (text.includes("error sending") || text.includes("confirmation email")) {
    return {
      status: 502,
      error: "email_delivery_failed",
      message: "We couldn't send your confirmation email. That's on us — please try again in a few minutes.",
      detail,
    };
  }

  if (code === "signup_disabled" || text.includes("signups not allowed")) {
    return {
      status: 403,
      error: "signups_disabled",
      message: "New accounts are turned off at the moment.",
      detail,
    };
  }

  if (code === "user_already_exists" || text.includes("already registered")) {
    return {
      status: 409,
      error: "email_taken",
      message: "That email already has an account — sign in instead.",
      detail,
    };
  }

  if (code === "email_address_invalid" || (text.includes("email") && text.includes("invalid"))) {
    return {
      status: 400,
      error: "email_invalid",
      message: "That email address doesn't look valid.",
      detail,
    };
  }

  // Supabase's own password wording is specific and useful ("at least one character of each..."),
  // so it is the message rather than something vaguer of our own.
  if (code === "weak_password" || text.includes("password")) {
    return { status: 400, error: "weak_password", message: detail, detail };
  }

  return { status: 400, error: "signup_failed", message: detail, detail };
}
