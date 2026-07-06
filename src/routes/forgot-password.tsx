import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

const schema = z.object({
  email: z.string().trim().email("Enter a valid email").max(255),
});

export const Route = createFileRoute("/forgot-password")({
  head: () => ({ meta: [{ title: "Forgot password · MySocLabs Attendance" }] }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const handle = async () => {
    const parsed = schema.safeParse({ email });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    try {
      await supabase.auth.resetPasswordForEmail(parsed.data.email, {
        captchaToken: captchaToken ?? undefined,
      });
    } finally {
      // Always show the same outcome, whether or not the email has an
      // account and regardless of any error Supabase returns, so this step
      // can never be used to enumerate which emails have accounts.
      setLoading(false);
      setSent(true);
    }
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
            <CardTitle>Forgot password</CardTitle>
            <CardDescription>
              {sent
                ? "If that email has an account, we've sent a 6-digit reset code."
                : "Enter your account email and we'll send you a reset code."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!sent ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder="admin@mysoclabs.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <TurnstileWidget onToken={setCaptchaToken} />
                <Button onClick={handle} disabled={loading} className="w-full">
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send reset code"}
                </Button>
              </>
            ) : (
              <Button
                onClick={() =>
                  // Cast needed until Task 4 adds the `/reset-password` route to the
                  // generated route tree; the target shape (search: { email }) is the
                  // one Task 4's route reads via validateSearch. Safe to drop the cast
                  // once that route exists.
                  navigate({ to: "/reset-password", search: { email } } as never)
                }
                className="w-full"
              >
                Enter code
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
