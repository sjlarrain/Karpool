import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/api/auth";
import { nextAnnouncementState } from "@/domain/announcement";

const bodySchema = z.object({ key: z.string().trim().min(1).max(64) });

// POST /api/me/announcement — "I've seen the what's-new sheet." D-61, shown up to
// ANNOUNCEMENT_MAX_VIEWS times per key (developer, 2026-09-19: "it needs to appear twice").
//
// Stores the announcement's key and view count on the caller's own profile, so a later
// announcement is a new key rather than a new column, and so "seen" follows the person rather than
// the browser or the device.
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  }

  // The admin client reads and writes it: a profile is not self-updatable through RLS, and this is
  // the caller's own row by construction — the id comes from the session, never from the body.
  const admin = createSupabaseAdminClient();
  const { data: profile, error: readError } = await admin
    .from("profile")
    .select("seen_announcement, announcement_seen_count")
    .eq("id", user.id)
    .maybeSingle();
  if (readError || !profile) {
    return NextResponse.json({ error: "profile_lookup_failed", message: readError?.message }, { status: 500 });
  }

  const next = nextAnnouncementState(
    { seenKey: profile.seen_announcement, seenCount: profile.announcement_seen_count },
    parsed.data.key,
  );

  const { error } = await admin
    .from("profile")
    .update({ seen_announcement: next.seenKey, announcement_seen_count: next.seenCount })
    .eq("id", user.id);
  if (error) {
    return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, seenCount: next.seenCount });
}
