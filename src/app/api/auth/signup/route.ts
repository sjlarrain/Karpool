import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// POST /api/auth/signup — step 1 of the sketch's two-step signup (credentials only; the group code
// step is a separate call to POST /api/groups/join once the account exists).
const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  displayName: z.string().trim().min(1, "Name is required").max(80),
});

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  }
  const { email, password, displayName } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName } },
  });

  if (error) {
    return NextResponse.json({ error: "signup_failed", message: error.message }, { status: 400 });
  }

  return NextResponse.json({
    user: data.user ? { id: data.user.id, email: data.user.email } : null,
    // Supabase returns session: null when the project requires email confirmation.
    needsEmailConfirmation: data.session === null,
  });
}
