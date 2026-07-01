import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

// Layer 2 defense-in-depth against brute-force login (Vulnerability Report finding #1).
// Supabase's own Auth rate limiting + CAPTCHA (configured in the dashboard) is the
// primary, unbypassable defense since it's enforced by the auth server itself
// regardless of how a request reaches it. This adds a second, independent layer:
// per-account lockout, tracked in our own DB, so a single compromised/misconfigured
// IP-based limit isn't the only thing standing between an attacker and an account.

const FAILURE_THRESHOLD = 5;
const WINDOW_MINUTES = 15;
const LOCKOUT_MINUTES = 15;

const loginSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(1).max(72),
  captchaToken: z.string().optional(),
});

function getClientIp(): string | null {
  const request = getRequest();
  const headers = request?.headers;
  if (!headers) return null;
  return (
    headers.get("cf-connecting-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null
  );
}

export const loginWithLockout = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => loginSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email = data.email.toLowerCase();
    const ip = getClientIp();
    const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString();

    const { data: recentFailures, error: countErr } = await supabaseAdmin
      .from("login_attempts")
      .select("id, created_at")
      .eq("email", email)
      .eq("success", false)
      .gte("created_at", windowStart)
      .order("created_at", { ascending: false });
    if (countErr) throw new Error("Login temporarily unavailable, try again shortly");

    if ((recentFailures?.length ?? 0) >= FAILURE_THRESHOLD) {
      const mostRecent = new Date(recentFailures![0].created_at);
      const lockedUntil = new Date(mostRecent.getTime() + LOCKOUT_MINUTES * 60_000);
      if (lockedUntil > new Date()) {
        const minutesLeft = Math.ceil((lockedUntil.getTime() - Date.now()) / 60_000);
        throw new Error(`Too many failed attempts. Try again in ${minutesLeft} minute${minutesLeft === 1 ? "" : "s"}.`);
      }
    }

    const SUPABASE_URL = process.env.SUPABASE_URL!;
    const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;
    const anon = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: signInData, error: signInError } = await anon.auth.signInWithPassword({
      email: data.email,
      password: data.password,
      options: data.captchaToken ? { captchaToken: data.captchaToken } : undefined,
    });

    await supabaseAdmin.from("login_attempts").insert({
      email,
      ip_address: ip,
      success: !signInError,
    });

    if (signInError || !signInData.session) {
      // Generic message regardless of cause (wrong password vs. no such account)
      // to avoid leaking which emails have accounts.
      throw new Error("Invalid email or password");
    }

    return {
      access_token: signInData.session.access_token,
      refresh_token: signInData.session.refresh_token,
    };
  });
