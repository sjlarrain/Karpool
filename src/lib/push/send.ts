import webpush from "web-push";
import { env } from "@/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Configured lazily, on first actual send, rather than at module import time — a bad VAPID_SUBJECT
// (web-push requires https: or mailto:) would otherwise crash every route that merely imports this
// module transitively, including ones that never end up sending a push (e.g. cron/tick's own
// auth check never gets to run).
//
// It also has to be lazy *and* non-throwing. Deferring the crash from import time to send time only
// moved it: `setVapidDetails` threw straight out of sendPushToProfile, through the Promise.all in
// notifyProfiles, and into the caller — so `POST /api/trips/:id/start` answered **500** for a trip
// that had in fact already started, and did so only once somebody had a push subscription on file.
// A misconfigured push channel is not a reason to fail the action the notification is about.
let vapidConfigured = false;
let vapidError: string | null = null;

function ensureVapidConfigured(): string | null {
  if (vapidConfigured) return null;
  if (vapidError) return vapidError;
  try {
    webpush.setVapidDetails(env.VAPID_SUBJECT, env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
    vapidConfigured = true;
    return null;
  } catch (error) {
    // Cached: the value cannot change without a redeploy, so retrying per send is pure cost.
    vapidError = error instanceof Error ? error.message : "VAPID configuration failed";
    return vapidError;
  }
}

// Whether the push channel can be used at all, for GET /api/admin/health. The D-21 lesson applied
// to push: "nobody got a notification" and "the VAPID subject is not a mailto: URL" look identical
// from the outside, and the second is a five-second fix nobody can make while it is invisible.
export function pushChannelStatus(): { configured: boolean; error: string | null } {
  const error = ensureVapidConfigured();
  return { configured: error === null, error };
}

export interface PushPayload {
  title: string;
  body: string;
  data?: { url?: string; tripId?: string };
}

export interface PushResult {
  sent: number;
  failed: number;
  /** Set when the push channel itself is misconfigured — every send fails for the same reason. */
  configError: string | null;
}

interface WebPushError {
  statusCode?: number;
}

// Sends a push to every subscription on file for a profile. A dead endpoint (404/410 — the push
// service itself says the subscription no longer exists, meaning the user uninstalled or revoked
// permission) is deleted rather than retried forever; any other failure just increments
// failure_count for later inspection (the admin "system health" section reads this).
export async function sendPushToProfile(profileId: string, payload: PushPayload): Promise<PushResult> {
  const admin = createSupabaseAdminClient();
  const { data: subscriptions } = await admin
    .from("push_subscription")
    .select("id, endpoint, p256dh, auth, failure_count")
    .eq("profile_id", profileId);

  if (!subscriptions || subscriptions.length === 0) return { sent: 0, failed: 0, configError: null };

  const configError = ensureVapidConfigured();
  if (configError) return { sent: 0, failed: subscriptions.length, configError };

  let sent = 0;
  let failed = 0;

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
        );
        sent += 1;
        await admin
          .from("push_subscription")
          .update({ last_success_at: new Date().toISOString(), failure_count: 0 })
          .eq("id", sub.id);
      } catch (error) {
        failed += 1;
        const statusCode = (error as WebPushError).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await admin.from("push_subscription").delete().eq("id", sub.id);
        } else {
          await admin.from("push_subscription").update({ failure_count: sub.failure_count + 1 }).eq("id", sub.id);
        }
      }
    }),
  );

  return { sent, failed, configError: null };
}
