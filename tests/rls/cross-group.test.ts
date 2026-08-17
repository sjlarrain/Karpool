import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// G2: "a cross-group read attempt in tests returns zero rows" (02_IMPLEMENTATION_PLAN.md).
// Requires a local Supabase instance (`supabase start`, which needs Docker Desktop) — not part of
// the default `pnpm test` / `pnpm verify` gate, run explicitly via `pnpm test:rls`. Skips itself
// (rather than failing) if SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY aren't set,
// so a clean checkout without Docker running never breaks the default gate.

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const PASSWORD = "rls-test-password-123!";

const canRun = Boolean(SERVICE_ROLE_KEY && ANON_KEY);

describe.skipIf(!canRun)("G2 — cross-group read isolation", () => {
  let admin: SupabaseClient;
  let userAClient: SupabaseClient;
  let groupAId: string;
  let groupBId: string;
  let userAId: string;
  let userBId: string;

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY as string);

    const stamp = Date.now();
    const { data: userA, error: userAErr } = await admin.auth.admin.createUser({
      email: `rls-test-a-${stamp}@example.com`,
      password: PASSWORD,
      email_confirm: true,
    });
    if (userAErr || !userA.user) throw userAErr ?? new Error("failed to create user A");
    userAId = userA.user.id;

    const { data: userB, error: userBErr } = await admin.auth.admin.createUser({
      email: `rls-test-b-${stamp}@example.com`,
      password: PASSWORD,
      email_confirm: true,
    });
    if (userBErr || !userB.user) throw userBErr ?? new Error("failed to create user B");
    userBId = userB.user.id;

    const { data: groupA, error: groupAErr } = await admin
      .from("group")
      .insert({
        name: "RLS Test Group A",
        origin_label: "A",
        dest_label: "HQ",
        code: `AAAA${String(stamp).slice(-2)}`,
        created_by: userA.user.id,
      })
      .select()
      .single();
    if (groupAErr || !groupA) throw groupAErr ?? new Error("failed to create group A");
    groupAId = groupA.id;

    const { data: groupB, error: groupBErr } = await admin
      .from("group")
      .insert({
        name: "RLS Test Group B",
        origin_label: "B",
        dest_label: "HQ",
        code: `BBBB${String(stamp).slice(-2)}`,
        created_by: userB.user.id,
      })
      .select()
      .single();
    if (groupBErr || !groupB) throw groupBErr ?? new Error("failed to create group B");
    groupBId = groupB.id;

    await admin.from("membership").insert({ group_id: groupA.id, profile_id: userA.user.id });
    await admin.from("membership").insert({ group_id: groupB.id, profile_id: userB.user.id });

    await admin.from("trip").insert({
      group_id: groupB.id,
      driver_id: userB.user.id,
      direction: "out",
      depart_at: new Date().toISOString(),
      capacity: 3,
    });

    userAClient = createClient(SUPABASE_URL, ANON_KEY as string);
    const { error: signInErr } = await userAClient.auth.signInWithPassword({
      email: userA.user.email as string,
      password: PASSWORD,
    });
    if (signInErr) throw signInErr;
  });

  it("returns zero rows when user A queries group B's trips", async () => {
    const { data, error } = await userAClient.from("trip").select("*").eq("group_id", groupBId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("returns zero rows when user A queries group B's row directly", async () => {
    const { data, error } = await userAClient.from("group").select("*").eq("id", groupBId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  afterAll(async () => {
    await userAClient?.auth.signOut();
    // Membership cascades from both group and profile deletion, but trip/group reference profile
    // via created_by/driver_id with no cascade — delete children before the users that own them.
    if (groupAId || groupBId) {
      await admin.from("trip").delete().in("group_id", [groupAId, groupBId].filter(Boolean));
      await admin.from("group").delete().in("id", [groupAId, groupBId].filter(Boolean));
    }
    if (userAId) await admin.auth.admin.deleteUser(userAId);
    if (userBId) await admin.auth.admin.deleteUser(userBId);
  });
});
