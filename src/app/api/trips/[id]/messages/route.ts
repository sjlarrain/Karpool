import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/api/auth";
import { checkRateLimit } from "@/lib/rateLimit";
import { notifyProfiles } from "@/lib/notify/tripNotify";
import { avatarColorFor } from "@/domain/avatarColor";
import { initialsFor } from "@/domain/initials";
import type { TripStatus } from "@/domain/types";
import {
  MAX_MESSAGE_LENGTH,
  canPostToTrip,
  canReadTrip,
  messageNotice,
  normalizeMessageBody,
  type ChatMessage,
  type SeatState,
} from "@/domain/tripChat";

// D-57 — the per-trip thread.
//
// The developer, 2026-09-07: "Can we built a in app chat to tell important messages to the people
// that is being pool. Example: I wait you here. I am here, etc." One thread per trip, asked and
// confirmed: their examples are about one ride at one moment, and a group-wide room would lose that
// the morning two cars leave at once.
//
// Who is in it — the driver plus everyone holding a seat — is decided by pure predicates in
// src/domain/tripChat.ts, unit-tested there, and applied identically on the read and the write. The
// table's RLS policy is bounded to the caller's group (D-04, defence in depth); the narrowing to
// "actually on this ride" happens here, because that is not something a policy expresses cheaply.

const postSchema = z.object({
  body: z.string().min(1).max(MAX_MESSAGE_LENGTH),
});

// A thread is coordination, so it is short. The cap is generous for a real morning ("I'm here",
// "north gate", "two minutes") and stingy for anything automated.
const RATE_LIMIT = 30;
const RATE_WINDOW_SECONDS = 10 * 60;

// Enough for any real trip's thread, and a bound rather than an unbounded read.
const MAX_THREAD = 200;

interface Participation {
  tripId: string;
  status: TripStatus;
  driverId: string;
  groupId: string;
  isDriver: boolean;
  seatState: SeatState | null;
}

/**
 * The caller's standing on this trip, or null when the trip is not visible to them at all.
 *
 * Read through the caller's own session, so RLS (`is_member`) turns another group's trip into the
 * same 404 as a trip that does not exist — the boundary is never a branch in this file.
 */
async function participation(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  tripId: string,
  profileId: string,
): Promise<Participation | null> {
  const { data: trip } = await supabase
    .from("trip")
    .select("id, status, driver_id, group_id")
    .eq("id", tripId)
    .maybeSingle();
  if (!trip) return null;

  const { data: seat } = await supabase
    .from("trip_rider")
    .select("state")
    .eq("trip_id", tripId)
    .eq("profile_id", profileId)
    .in("state", ["joined", "confirmed"])
    .maybeSingle();

  return {
    tripId: trip.id,
    status: trip.status,
    driverId: trip.driver_id,
    groupId: trip.group_id,
    isDriver: trip.driver_id === profileId,
    seatState: (seat?.state as SeatState | undefined) ?? null,
  };
}

// GET /api/trips/:id/messages — the thread, oldest first.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const standing = await participation(supabase, id, user.id);
  if (!standing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  // A group member who is not on this ride is told the same thing as a stranger. "You may not read
  // this" would itself disclose that there is a thread worth reading.
  if (!canReadTrip(standing)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { data: rows, error } = await supabase
    .from("trip_message")
    .select("id, profile_id, body, created_at")
    .eq("trip_id", id)
    .order("created_at", { ascending: true })
    .limit(MAX_THREAD);
  if (error) {
    // Never a 404 and never an empty thread: telling someone their messages are gone when the query
    // simply failed is the same failure mode the rider lookup in GET /api/trips/:id was fixed for.
    return NextResponse.json({ error: "message_lookup_failed", message: error.message }, { status: 500 });
  }

  const authorIds = [...new Set((rows ?? []).map((r) => r.profile_id))];
  const { data: authors } = authorIds.length
    ? await supabase.from("profile").select("id, display_name, initials, avatar_color").in("id", authorIds)
    : { data: [] };
  const authorById = new Map((authors ?? []).map((p) => [p.id, p]));

  const messages: ChatMessage[] = (rows ?? []).map((row) => {
    const author = authorById.get(row.profile_id);
    const name = author?.display_name ?? "Someone";
    return {
      id: row.id,
      authorId: row.profile_id,
      authorName: name,
      // Same fallbacks the rest of the app uses for anyone whose profile columns are unset, so a
      // chat bubble can never render an avatar the trip card would have coloured differently.
      initials: author?.initials ?? initialsFor(name),
      color: author?.avatar_color ?? avatarColorFor(row.profile_id),
      body: row.body,
      createdAt: row.created_at,
      mine: row.profile_id === user.id,
    };
  });

  return NextResponse.json({ messages, canPost: canPostToTrip(standing) });
}

// POST /api/trips/:id/messages — say something to the people on this ride.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = postSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  }
  // zod bounds the raw string; this bounds what is actually stored — a message of 500 spaces passes
  // the first and is nothing at all.
  const body = normalizeMessageBody(parsed.data.body);
  if (!body) {
    return NextResponse.json({ error: "invalid_request", message: "Write something first." }, { status: 400 });
  }

  const standing = await participation(supabase, id, user.id);
  if (!standing || !canReadTrip(standing)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!canPostToTrip(standing)) {
    return NextResponse.json(
      { error: "wrong_status", message: "This trip is over — its chat is read-only now." },
      { status: 409 },
    );
  }

  const admin = createSupabaseAdminClient();
  const { allowed } = await checkRateLimit(admin, user.id, "trip_message", RATE_LIMIT, RATE_WINDOW_SECONDS);
  if (!allowed) {
    return NextResponse.json(
      { error: "rate_limited", message: "That's a lot of messages — give it a minute." },
      { status: 429 },
    );
  }

  const { data: inserted, error } = await admin
    .from("trip_message")
    .insert({ trip_id: id, profile_id: user.id, body })
    .select("id, profile_id, body, created_at")
    .single();
  if (error || !inserted) {
    return NextResponse.json({ error: "send_failed", message: error?.message }, { status: 500 });
  }

  // Everyone else on the ride, and only them. Guests hold seats but no profile and no device, so
  // they fall out of this list the same way they fall out of every other notification (D-09).
  const { data: seats } = await admin
    .from("trip_rider")
    .select("profile_id")
    .eq("trip_id", id)
    .in("state", ["joined", "confirmed"]);
  const audience = [standing.driverId, ...(seats ?? []).map((s) => s.profile_id)]
    .filter((pid): pid is string => !!pid)
    .filter((pid) => pid !== user.id);

  const { data: author } = await supabase.from("profile").select("display_name").eq("id", user.id).maybeSingle();
  const notice = messageNotice(author?.display_name ?? "", body);

  // Fired after the row is committed, and its failure is reported rather than thrown: the message
  // exists and is on-screen for anyone with the thread open. This is D-39's standing rule — the
  // thing being announced must never depend on the announcement.
  const notify = await notifyProfiles(audience, { type: "comment", ...notice, tripId: id });

  return NextResponse.json(
    {
      message: {
        id: inserted.id,
        authorId: inserted.profile_id,
        body: inserted.body,
        createdAt: inserted.created_at,
      },
      notified: notify.notified,
      notifyError: notify.error,
    },
    { status: 201 },
  );
}
