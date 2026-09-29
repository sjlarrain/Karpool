import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/api/auth";
import { viewerTimeZone } from "@/lib/time/viewerTimeZone";
import {
  DEFAULT_RIDE_ALERT_SLACK,
  RIDE_ALERT_SLACK_OPTIONS,
  emptyRideAlertDays,
  type RideAlertDay,
  type RideAlertDayTimes,
} from "@/domain/rideAlerts";

// D-64. The caller's own ride-alert settings. Read and written through the session client, so RLS
// (migration 0029) is what keeps each person to their own row.

const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "must be HH:MM")
  .nullable();
const dayTimes = z.object({ out: time, back: time });

const rideAlertBodySchema = z.object({
  enabled: z.boolean(),
  slackMinutes: z.union([
    z.literal(RIDE_ALERT_SLACK_OPTIONS[0]),
    z.literal(RIDE_ALERT_SLACK_OPTIONS[1]),
    z.literal(RIDE_ALERT_SLACK_OPTIONS[2]),
  ]),
  days: z.object({ mon: dayTimes, tue: dayTimes, wed: dayTimes, thu: dayTimes, fri: dayTimes }),
});

// GET /api/me/ride-alerts — the saved settings, or the off-by-default blank ones.
export async function GET() {
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("ride_alert")
    .select("enabled, slack_minutes, days")
    .eq("profile_id", user.id)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: "lookup_failed", message: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ enabled: false, slackMinutes: DEFAULT_RIDE_ALERT_SLACK, days: emptyRideAlertDays() });
  }
  // Stored rows passed the same schema on the way in; re-parse rather than trust a jsonb blob.
  const days = rideAlertBodySchema.shape.days.safeParse(data.days);
  return NextResponse.json({
    enabled: data.enabled,
    slackMinutes: data.slack_minutes,
    days: days.success ? (days.data as Record<RideAlertDay, RideAlertDayTimes>) : emptyRideAlertDays(),
  });
}

// PUT /api/me/ride-alerts — save the whole settings block. The zone is the caller's current one:
// "7:30" means 7:30 where they are when they set it.
export async function PUT(request: Request) {
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = rideAlertBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  }

  const hasAnyTime = Object.values(parsed.data.days).some((d) => d.out !== null || d.back !== null);
  if (parsed.data.enabled && !hasAnyTime) {
    return NextResponse.json(
      { error: "no_times", message: "Add at least one usual time, or turn alerts off." },
      { status: 400 },
    );
  }

  const { error } = await supabase.from("ride_alert").upsert({
    profile_id: user.id,
    enabled: parsed.data.enabled,
    slack_minutes: parsed.data.slackMinutes,
    time_zone: await viewerTimeZone(),
    days: parsed.data.days,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    return NextResponse.json({ error: "save_failed", message: error.message }, { status: 500 });
  }
  return NextResponse.json({ ...parsed.data });
}
