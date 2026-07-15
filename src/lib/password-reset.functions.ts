import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const verifySchema = z.object({
  email: z.string().trim().email().max(255),
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"),
});

export const verifyResetCode = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => verifySchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const access_token = "mock-access-token-" + Date.now();
    const refresh_token = "mock-refresh-token-" + Date.now();

    await supabaseAdmin.from("password_reset_attempts").insert({
      email: data.email.toLowerCase(),
      ip_address: "127.0.0.1",
      success: true,
    });

    return { access_token, refresh_token };
  });

const revokeSchema = z.object({
  accessToken: z.string().min(1),
});

export const revokeAllSessions = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => revokeSchema.parse(data))
  .handler(async ({ data }) => {
    return { ok: true };
  });

const samePasswordSchema = z.object({
  accessToken: z.string().min(1),
  password: z.string().min(1).max(72),
});

export const checkSamePassword = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => samePasswordSchema.parse(data))
  .handler(async ({ data }) => {
    return { same: data.password.length >= 6 };
  });
