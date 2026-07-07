import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { getClientIp } from "@/lib/login.functions";

// Layer 2 defense-in-depth against brute-forcing the emailed reset code,
// mirroring the login lockout in login.functions.ts (itself a fix for
// Vulnerability Report finding #1). Supabase's own single-use, expiring OTP
// is the primary defense; this adds a second, independent layer: per-email
// attempt lockout tracked in our own DB. 5 guesses per 15-minute window
// against a 6-digit (1,000,000-value) code is not practically brute-forceable.

const FAILURE_THRESHOLD = 5;
const WINDOW_MINUTES = 15;
const LOCKOUT_MINUTES = 15;

const verifySchema = z.object({
  email: z.string().trim().email().max(255),
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"),
});

export const verifyResetCode = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => verifySchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email = data.email.toLowerCase();
    const ip = getClientIp();
    const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();

    const { data: recentFailures, error: countErr } = await supabaseAdmin
      .from("password_reset_attempts")
      .select("id, created_at")
      .eq("email", email)
      .eq("success", false)
      .gte("created_at", windowStart)
      .order("created_at", { ascending: false });
    if (countErr) throw new Error("Reset temporarily unavailable, try again shortly");

    if ((recentFailures?.length ?? 0) >= FAILURE_THRESHOLD) {
      const mostRecent = new Date(recentFailures![0].created_at);
      const lockedUntil = new Date(mostRecent.getTime() + LOCKOUT_MINUTES * 60_000);
      if (lockedUntil > new Date()) {
        const minutesLeft = Math.ceil((lockedUntil.getTime() - Date.now()) / 60_000);
        throw new Error(`Too many attempts. Try again in ${minutesLeft} minute${minutesLeft === 1 ? "" : "s"}.`);
      }
    }

    const SUPABASE_URL = process.env.SUPABASE_URL!;
    const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;
    const anon = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: verifyData, error: verifyError } = await anon.auth.verifyOtp({
      email: data.email,
      token: data.code,
      type: "recovery",
    });

    await supabaseAdmin.from("password_reset_attempts").insert({
      email,
      ip_address: ip,
      success: !verifyError,
    });

    if (verifyError || !verifyData.session) {
      throw new Error("Invalid or expired code.");
    }

    return {
      access_token: verifyData.session.access_token,
      refresh_token: verifyData.session.refresh_token,
    };
  });

const revokeSchema = z.object({
  accessToken: z.string().min(1),
});

export const revokeAllSessions = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => revokeSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.signOut(data.accessToken, "global");
    if (error) throw new Error("Could not fully revoke existing sessions");
    return { ok: true };
  });

const samePasswordSchema = z.object({
  accessToken: z.string().min(1),
  password: z.string().min(1).max(72),
});

// The email is resolved from the caller's own access token (never accepted
// as a client-supplied parameter), so this can't be used as a password-
// guessing oracle against an arbitrary account. Reaching this function at
// all already requires a session obtained via verifyResetCode's rate-limited
// OTP check, so no separate attempt lockout is layered on top here.
export const checkSamePassword = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => samePasswordSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(data.accessToken);
    if (userError || !userData.user?.email) throw new Error("Your session expired, please request a new code.");

    const SUPABASE_URL = process.env.SUPABASE_URL!;
    const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;
    const anon = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { error: signInError } = await anon.auth.signInWithPassword({
      email: userData.user.email,
      password: data.password,
    });

    return { same: !signInError };
  });
