import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendPushToProfile } from "@/lib/push/send";
import type { Database } from "@/types/database";

type NotificationType = Database["public"]["Tables"]["notification"]["Row"]["type"];

// Shared by the trip start/close/edit routes: write the notification row(s) the in-app bell will
// eventually read (Phase 8+), then push each recipient's devices. Push failures are handled inside
// sendPushToProfile (dead subscriptions are pruned there) — a push failure never blocks the
// notification row from existing.
export async function notifyProfiles(
  profileIds: string[],
  notification: { type: NotificationType; title: string; body: string; tripId?: string },
): Promise<void> {
  if (profileIds.length === 0) return;

  const admin = createSupabaseAdminClient();
  await admin.from("notification").insert(
    profileIds.map((profileId) => ({
      profile_id: profileId,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      payload: notification.tripId ? { tripId: notification.tripId } : null,
    })),
  );

  await Promise.all(
    profileIds.map((profileId) =>
      sendPushToProfile(profileId, {
        title: notification.title,
        body: notification.body,
        data: notification.tripId ? { tripId: notification.tripId, url: "/app" } : undefined,
      }),
    ),
  );
}
