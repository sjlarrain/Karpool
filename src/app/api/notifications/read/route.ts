import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/api/auth";

// POST /api/notifications/read — mark notifications read, clearing the bell's unread dot.
// With no ids, marks every unread row for the caller (what opening the sheet does).
// Writes through the session client, so RLS (notification_own_update, migration 0005) is what
// actually enforces ownership — a caller cannot mark someone else's row read even by guessing an id.
const bodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(50).optional(),
});

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const json = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(json ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  }

  let query = supabase
    .from("notification")
    .update({ read_at: new Date().toISOString() })
    .eq("profile_id", user.id)
    .is("read_at", null);

  if (parsed.data.ids) {
    query = query.in("id", parsed.data.ids);
  }

  const { data, error } = await query.select("id");
  if (error) {
    return NextResponse.json({ error: "notifications_update_failed" }, { status: 500 });
  }

  return NextResponse.json({ updated: (data ?? []).length });
}
