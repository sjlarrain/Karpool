import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";

// audit_log is append-only (no UPDATE/DELETE grants) per D-14 — every admin mutation and every
// user-detail open writes a row here (G10). actorProfileId: null marks a system action (e.g. cron),
// not an admin — same convention already used by /api/cron/tick's auto-close.
export async function writeAuditLog(
  admin: SupabaseClient<Database>,
  params: {
    actorProfileId: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    before?: Json | null;
    after?: Json | null;
    request?: Request;
  },
) {
  const ip = params.request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = params.request?.headers.get("user-agent") ?? null;

  await admin.from("audit_log").insert({
    actor_profile_id: params.actorProfileId,
    action: params.action,
    entity_type: params.entityType,
    entity_id: params.entityId ?? null,
    before: params.before ?? null,
    after: params.after ?? null,
    ip,
    user_agent: userAgent,
  });
}
