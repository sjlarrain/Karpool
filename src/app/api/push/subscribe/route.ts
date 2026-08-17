import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/api/auth";

// POST /api/push/subscribe — store a browser's PushSubscription (from
// registration.pushManager.subscribe()). Upserts on endpoint so re-subscribing (e.g. after a key
// rotation) updates the existing row instead of duplicating it.
const bodySchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

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

  const admin = createSupabaseAdminClient();
  const { data: subscription, error } = await admin
    .from("push_subscription")
    .upsert(
      {
        profile_id: user.id,
        endpoint: parsed.data.endpoint,
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
        user_agent: request.headers.get("user-agent"),
      },
      { onConflict: "endpoint" },
    )
    .select()
    .single();

  if (error || !subscription) {
    return NextResponse.json({ error: "subscribe_failed", message: error?.message }, { status: 500 });
  }

  return NextResponse.json({ subscription }, { status: 201 });
}
