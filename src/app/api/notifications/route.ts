import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/api/auth";

// GET /api/notifications — the caller's own notification feed, newest first, for the header bell.
// Rows have been written since Phase 5 (trip start/close/edit + the cron departure reminder) but
// nothing ever read them back; this is that missing half. RLS (notification_own_select) already
// restricts the session client to the caller's rows, so no extra ownership filter is needed here —
// the explicit profile_id eq is belt-and-braces, and keeps the query honest if the policy ever moves.
const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(30),
});

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({ limit: searchParams.get("limit") ?? undefined });
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("notification")
    .select("id, type, title, body, payload, read_at, created_at")
    .eq("profile_id", user.id)
    .order("created_at", { ascending: false })
    .limit(parsed.data.limit);

  if (error) {
    return NextResponse.json({ error: "notifications_load_failed" }, { status: 500 });
  }

  const notifications = (data ?? []).map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    tripId: (n.payload as { tripId?: string } | null)?.tripId ?? null,
    read: n.read_at !== null,
    createdAt: n.created_at,
  }));

  return NextResponse.json({
    notifications,
    unreadCount: notifications.filter((n) => !n.read).length,
  });
}
