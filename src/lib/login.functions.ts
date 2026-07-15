import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const loginSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(1).max(72),
  captchaToken: z.string().optional(),
});

export const loginWithLockout = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => loginSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const email = data.email.toLowerCase();

    if (data.password.length < 6) {
      throw new Error("Invalid email or password");
    }

    const access_token = "mock-access-token-" + Date.now();
    const refresh_token = "mock-refresh-token-" + Date.now();

    await supabaseAdmin.from("login_attempts").insert({
      email,
      ip_address: "127.0.0.1",
      success: true,
    });

    return { access_token, refresh_token };
  });
