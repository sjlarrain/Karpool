import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AuthGate } from "@/app/AuthGate";

// /t/:id — the destination of the ride share link (TripDetailOverlay's share button). Meant to be
// pasted into WhatsApp, so it is written for the case where it reaches someone outside the group.
//
// D-20: the link carries no information of its own. Signed out -> the auth screen, nothing about
// the ride. Signed in but not in the group -> RLS (is_member) returns no row, so the page can't
// leak the ride's existence even if it wanted to (the plan's "404 never leaks across groups").
// Signed in and a member -> straight into the trip detail overlay on the Carpools tab.
//
// Signing in re-runs this component (AuthGate calls router.refresh()), so an invited-and-joined
// visitor lands on the ride without having to find the link a second time.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main style={{ minHeight: "100vh" }}>
      <div style={{ maxWidth: 430, margin: "0 auto" }}>{children}</div>
    </main>
  );
}

function Dead({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <Shell>
      <div style={{ padding: "72px 24px", textAlign: "center" }}>
        <div style={{ fontSize: 40 }}>{icon}</div>
        <h1 style={{ font: "800 22px var(--font-display)", color: "var(--ink)", margin: "14px 0 6px" }}>{title}</h1>
        <p style={{ font: "500 13px/1.5 var(--font-body)", color: "var(--muted)", margin: "0 0 20px" }}>{body}</p>
        <Link href="/" className="btnG" style={{ display: "block", textDecoration: "none" }}>
          Go to Carpool
        </Link>
      </div>
    </Shell>
  );
}

export default async function RideLinkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!UUID.test(id)) {
    return (
      <Dead
        icon="🔗"
        title="That ride link isn't valid"
        body="Ask whoever shared it to send a fresh one."
      />
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();

  if (!userData.user) {
    return (
      <Shell>
        <div style={{ padding: "40px 24px 0", textAlign: "center" }}>
          <div style={{ fontSize: 34 }}>🔒</div>
          <h1 style={{ font: "800 24px var(--font-display)", color: "var(--ink)", margin: "12px 0 4px" }}>
            Sign in to see this ride
          </h1>
          <p style={{ font: "500 12.5px/1.5 var(--font-body)", color: "var(--muted)", margin: 0 }}>
            Rides are only visible to members of the carpool group they belong to.
          </p>
        </div>
        <AuthGate hideHero />
      </Shell>
    );
  }

  // Session client on purpose: RLS decides whether this viewer may know the ride exists at all.
  const { data: trip } = await supabase.from("trip").select("id, group_id").eq("id", id).maybeSingle();

  if (!trip) {
    return (
      <Dead
        icon="🚗"
        title="This ride isn't available to you"
        body="It may have been removed, or it belongs to a carpool group you're not in. Ask whoever shared it for the group's invite link."
      />
    );
  }

  redirect(`/app?g=${trip.group_id}&trip=${trip.id}`);
}
