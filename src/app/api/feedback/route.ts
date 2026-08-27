import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/api/auth";
import { checkRateLimit } from "@/lib/rateLimit";

const bodySchema = z.object({
  category: z.enum(["bug", "idea", "praise", "other"]),
  message: z.string().trim().min(1).max(2000),
  groupId: z.string().uuid().optional(),
});

// POST /api/feedback — D-25: in-app feedback, stored in Postgres and read from the admin console.
// Not emailed: the project has no custom SMTP (D-22), and feedback that depends on mail delivery is
// feedback that silently doesn't arrive.
//
// The sender's identity comes from the session, never from the body — self-reported authorship on a
// feedback form is a way to put words in a colleague's mouth.
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const json = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();

  const { allowed } = await checkRateLimit(admin, user.id, "feedback", 10, 3600);
  if (!allowed) {
    return NextResponse.json(
      { error: "rate_limited", message: "That's a lot of feedback — try again in a little while." },
      { status: 429 },
    );
  }

  // A group id in the body is only a hint about which group the sender was looking at; it's checked
  // against their real memberships before being stored.
  let groupId: string | null = null;
  if (parsed.data.groupId) {
    const { data: membership } = await supabase
      .from("membership")
      .select("group_id")
      .eq("group_id", parsed.data.groupId)
      .eq("profile_id", user.id)
      .maybeSingle();
    groupId = membership?.group_id ?? null;
  }

  const { data: feedback, error } = await admin
    .from("feedback")
    .insert({
      profile_id: user.id,
      group_id: groupId,
      category: parsed.data.category,
      message: parsed.data.message,
      user_agent: request.headers.get("user-agent"),
    })
    .select("id, created_at")
    .single();

  if (error || !feedback) {
    return NextResponse.json({ error: "feedback_failed", message: error?.message }, { status: 500 });
  }

  return NextResponse.json({ feedback }, { status: 201 });
}
