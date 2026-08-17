import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/api/auth";

// POST /api/push/unsubscribe — remove a browser's PushSubscription. Scoped to the caller's own
// subscriptions so one user can't delete another's by guessing an endpoint.
const bodySchema = z.object({ endpoint: z.string().url() });

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
  const { error } = await admin
    .from("push_subscription")
    .delete()
    .eq("profile_id", user.id)
    .eq("endpoint", parsed.data.endpoint);

  if (error) {
    return NextResponse.json({ error: "unsubscribe_failed", message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
