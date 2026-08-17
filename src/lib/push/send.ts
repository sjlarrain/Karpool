import webpush from "web-push";
import { env } from "@/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Configured lazily, on first actual send, rather than at module import time — a bad VAPID_SUBJECT
// (web-push requires https: or mailto:) would otherwise crash every route that merely imports this
// module transitively, including ones that never end up sending a push (e.g. cron/tick's own
// auth check never gets to run).
let vapidConfigured = false;
function ensureVapidConfigured() {
  if (vapidConfigured) return;
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  vapidConfigured = true;
}

export interface PushPayload {
  title: string;
  body: string;
  data?: { url?: string; tripId?: string };
}

interface WebPushError {
  statusCode?: number;
}

// Sends a push to every subscription on file for a profile. A dead endpoint (404/410 — the push
// service itself says the subscription no longer exists, meaning the user uninstalled or revoked
// permission) is deleted rather than retried forever; any other failure just increments
// failure_count for later inspection (Phase 8's admin "system health" section reads this).
export async function sendPushToProfile(profileId: string, payload: PushPayload): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { data: subscriptions } = await admin
    .from("push_subscription")
    .select("id, endpoint, p256dh, auth, failure_count")
    .eq("profile_id", profileId);

  if (!subscriptions || subscriptions.length === 0) return;

  ensureVapidConfigured();

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
        );
        await admin
          .from("push_subscription")
          .update({ last_success_at: new Date().toISOString(), failure_count: 0 })
          .eq("id", sub.id);
      } catch (error) {
        const statusCode = (error as WebPushError).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await admin.from("push_subscription").delete().eq("id", sub.id);
        } else {
          await admin.from("push_subscription").update({ failure_count: sub.failure_count + 1 }).eq("id", sub.id);
        }
      }
    }),
  );
}
