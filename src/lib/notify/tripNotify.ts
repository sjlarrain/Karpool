import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendPushToProfile } from "@/lib/push/send";
import type { Database } from "@/types/database";

type NotificationType = Database["public"]["Tables"]["notification"]["Row"]["type"];

export interface NotifyResult {
  /** Distinct profiles the notification rows were written for. 0 when the insert failed. */
  notified: number;
  /** The insert failure, if there was one. Never silently discarded (CLAUDE.md §3.5). */
  error: string | null;
  /** Devices the push actually reached. Zero with `notified` above zero means push is not working. */
  pushed: number;
  /** Set when the push channel itself is misconfigured (e.g. an invalid `VAPID_SUBJECT`). */
  pushConfigError: string | null;
}

// Shared by the trip start/close/edit routes and the scheduler: write the notification row(s) the
// in-app bell reads, then push each recipient's devices. Push failures are handled inside
// sendPushToProfile (dead subscriptions are pruned there) — a push failure never blocks the
// notification row from existing.
//
// The result is returned rather than thrown: by the time a notification is being sent the thing it
// describes has already happened (the trip started, the trip was edited), so failing the caller's
// request would misreport a success as a failure. Callers surface `notified` in their response
// instead, which is what makes a broken notification path visible rather than invisible.
export async function notifyProfiles(
  profileIds: string[],
  notification: { type: NotificationType; title: string; body: string; tripId?: string },
): Promise<NotifyResult> {
  // A driver who also holds a rider row (D-24 lets a driver add seats) would otherwise be told
  // twice about their own trip — once as driver, once as passenger.
  const recipients = [...new Set(profileIds.filter(Boolean))];
  if (recipients.length === 0) return { notified: 0, error: null, pushed: 0, pushConfigError: null };

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("notification").insert(
    recipients.map((profileId) => ({
      profile_id: profileId,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      payload: notification.tripId ? { tripId: notification.tripId } : null,
    })),
  );

  // No row means no bell entry and, worse, no dedupe marker for the scheduler — which would then
  // re-send the same reminder on every tick. Report it; don't push on top of a failed write.
  if (error) return { notified: 0, error: error.message, pushed: 0, pushConfigError: null };

  const results = await Promise.all(
    recipients.map((profileId) =>
      sendPushToProfile(profileId, {
        title: notification.title,
        body: notification.body,
        data: notification.tripId ? { tripId: notification.tripId, url: "/app" } : undefined,
      }),
    ),
  );

  return {
    notified: recipients.length,
    error: null,
    pushed: results.reduce((sum, r) => sum + r.sent, 0),
    pushConfigError: results.find((r) => r.configError)?.configError ?? null,
  };
}
