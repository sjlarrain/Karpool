import { NextResponse } from "next/server";
import { z } from "zod";
import { appOriginFor, emailConfirmRedirectUrl, groupInvitePath } from "@/domain/authRedirect";
import { env } from "@/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// POST /api/auth/signup — step 1 of the sketch's two-step signup (credentials only; the group code
// step is a separate call to POST /api/groups/join once the account exists).
//
// `groupCode` is optional and only travels through the confirmation email: a visitor who arrived on
// /j/CODE has already told us which group they want, and without carrying it across the email round
// trip they come back signed out with nothing to show for the invite they clicked.
const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  displayName: z.string().trim().min(1, "Name is required").max(80),
  groupCode: z.string().trim().max(16).optional(),
});

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  }
  const { email, password, displayName, groupCode } = parsed.data;

  // An unusable code is simply not carried — it must never fail an otherwise valid signup.
  const invitePath = groupInvitePath(groupCode);

  // The confirmation link must return to the origin the visitor is actually using — localhost in
  // dev, the preview URL on a preview deploy — not always the production one.
  const origin = appOriginFor({
    requestUrl: request.url,
    forwardedHost: request.headers.get("x-forwarded-host"),
    forwardedProto: request.headers.get("x-forwarded-proto"),
    configuredOrigin: env.NEXT_PUBLIC_APP_URL,
  });

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        display_name: displayName,
        // Belt and braces with `next`: survives an email client that strips the query string.
        ...(invitePath ? { pending_group_code: groupCode?.trim().toUpperCase() } : {}),
      },
      emailRedirectTo: emailConfirmRedirectUrl(origin, invitePath),
    },
  });

  if (error) {
    return NextResponse.json({ error: "signup_failed", message: error.message }, { status: 400 });
  }

  return NextResponse.json({
    user: data.user ? { id: data.user.id, email: data.user.email } : null,
    // Supabase returns session: null when the project requires email confirmation.
    needsEmailConfirmation: data.session === null,
  });
}
