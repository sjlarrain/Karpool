import { NextResponse } from "next/server";
import { env } from "@/env";
import { appOriginFor, groupInvitePath, safeNextPath } from "@/domain/authRedirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// GET /auth/callback — the landing point of the confirmation link in the signup email.
//
// Without this route signup was a dead end: `POST /api/auth/signup` sent no `emailRedirectTo`, so
// Supabase used the project's Site URL, the visitor came back to `/` signed **out**, and the invite
// code they arrived with was gone. Here the link's token is exchanged for a real session cookie and
// the visitor is put back where they were heading — normally `/j/CODE`, which joins the group.
//
// Two token shapes are accepted because the answer depends on the project's email template:
//   `?code=`       — PKCE (the default `{{ .ConfirmationURL }}` template). Needs the code_verifier
//                    cookie set at signup, so it only works in the browser that signed up.
//   `?token_hash=` — the `{{ .TokenHash }}` template. Works on any device, including the phone the
//                    email happened to be opened on.

// The subset of Supabase's EmailOtpType this app can ever receive; anything else is a bad link.
const EMAIL_OTP_TYPES = ["signup", "email", "magiclink", "recovery", "invite", "email_change"] as const;
type EmailOtp = (typeof EMAIL_OTP_TYPES)[number];

function isEmailOtp(value: string | null): value is EmailOtp {
  return value !== null && (EMAIL_OTP_TYPES as readonly string[]).includes(value);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = appOriginFor({
    requestUrl: request.url,
    forwardedHost: request.headers.get("x-forwarded-host"),
    forwardedProto: request.headers.get("x-forwarded-proto"),
    configuredOrigin: env.NEXT_PUBLIC_APP_URL,
  });

  // Errors land on the auth screen with a reason it can explain, never on a blank page.
  const fail = (reason: "link_invalid" | "link_expired") => NextResponse.redirect(`${origin}/?auth=${reason}`);

  // Supabase reports its own failures (expired/consumed link) on the query string.
  if (url.searchParams.get("error") || url.searchParams.get("error_code")) return fail("link_expired");

  const next = safeNextPath(url.searchParams.get("next"));
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");

  const supabase = await createSupabaseServerClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return fail("link_expired");
  } else if (tokenHash && isEmailOtp(type)) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) return fail("link_expired");
  } else {
    return fail("link_invalid");
  }

  // Fallback for a lost `next`: the code the visitor signed up with is also stashed in their user
  // metadata, so an email client that strips query params still can't lose the invite.
  if (next === "/app") {
    const { data } = await supabase.auth.getUser();
    const pending = data.user?.user_metadata?.pending_group_code;
    const invite = groupInvitePath(typeof pending === "string" ? pending : null);
    if (invite) return NextResponse.redirect(`${origin}${invite}`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
