import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/api/auth";

const bodySchema = z.object({ key: z.string().trim().min(1).max(64) });

// POST /api/me/announcement — "I've seen the what's-new sheet." D-61.
//
// Stores the announcement's key on the caller's own profile, so a later announcement is a new key
// and not a new column, and so "seen" follows the person rather than the browser.
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

  // The admin client writes it: a profile is not self-updatable through RLS, and this is the
  // caller's own row by construction — the id comes from the session, never from the body.
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("profile").update({ seen_announcement: parsed.data.key }).eq("id", user.id);
  if (error) {
    return NextResponse.json({ error: "update_failed", message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
