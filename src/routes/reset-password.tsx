import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { verifyResetCode, revokeAllSessions } from "@/lib/password-reset.functions";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

const codeSchema = z.object({
  email: z.string().trim().email("Enter a valid email").max(255),
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"),
});

const passwordSchema = z
  .object({
    password: z.string().min(6, "Password must be at least 6 characters").max(72),
    confirm: z.string(),
  })
  .refine((data) => data.password === data.confirm, {
    message: "Passwords don't match",
    path: ["confirm"],
  });

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "Reset password · MySocLabs Attendance" }] }),
  validateSearch: (search: Record<string, unknown>) => ({
    email: typeof search.email === "string" ? search.email : "",
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const { email: initialEmail } = useSearch({ from: "/reset-password" });
  const verify = useServerFn(verifyResetCode);
  const revoke = useServerFn(revokeAllSessions);

  const [step, setStep] = useState<"code" | "password">("code");
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (step !== "password") return;
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        toast.error("Your session expired, please request a new code.");
        setStep("code");
      }
    });
  }, [step]);

  const handleVerify = async () => {
    const parsed = codeSchema.safeParse({ email, code });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    try {
      const { access_token, refresh_token } = await verify({ data: parsed.data });
      const { error } = await supabase.auth.setSession({ access_token, refresh_token });
      if (error) throw error;
      setStep("password");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not verify code";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    const parsed = z.string().trim().email("Enter a valid email").max(255).safeParse(email);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    try {
      await supabase.auth.resetPasswordForEmail(parsed.data, {
        captchaToken: captchaToken ?? undefined,
      });
    } finally {
      setLoading(false);
      toast.success("If that email has an account, a new code is on its way.");
    }
  };

  const handleReset = async () => {
    const parsed = passwordSchema.safeParse({ password, confirm });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    let accessToken: string | undefined;
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        toast.error("Your session expired, please request a new code.");
        setStep("code");
        return;
      }
      const { error: updateError } = await supabase.auth.updateUser({ password: parsed.data.password });
      if (updateError) throw updateError;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not update password";
      toast.error(msg);
      return;
    } finally {
      setLoading(false);
    }

    // Password update succeeded — the rest is best-effort cleanup and must not
    // prevent the user from landing signed-out on /auth.
    try {
      await revoke({ data: { accessToken } });
    } catch (err) {
      console.error("Failed to revoke sessions after password reset", err);
    }
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error("Failed to sign out locally after password reset", err);
    }
    toast.success("Password updated — please log in.");
    navigate({ to: "/auth", replace: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <h1 className="text-2xl font-semibold tracking-tight">MySocLabs</h1>
          <p className="mt-1 text-sm text-muted-foreground">Attendance System · Admin Portal</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Reset password</CardTitle>
            <CardDescription>
              {step === "code" ? "Enter the 6-digit code we emailed you." : "Choose a new password."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {step === "code" ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="code">Code</Label>
                  <Input
                    id="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="123456"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  />
                </div>
                <TurnstileWidget onToken={setCaptchaToken} />
                <Button onClick={handleVerify} disabled={loading} className="w-full">
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify code"}
                </Button>
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={loading}
                  className="w-full text-sm text-muted-foreground hover:text-foreground"
                >
                  Didn't get a code? Resend
                </button>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="password">New password</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm">Confirm password</Label>
                  <Input
                    id="confirm"
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                </div>
                <Button onClick={handleReset} disabled={loading} className="w-full">
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Reset password"}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
