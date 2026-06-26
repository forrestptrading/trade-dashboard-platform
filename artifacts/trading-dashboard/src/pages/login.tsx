import { useState } from "react";
import { useLocation, Link } from "wouter";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { registerUser, loginUser, authErrorMessage } from "@/lib/auth-api";
import { useAuth } from "@/lib/auth-context";

type Mode = "login" | "register";

export default function Login() {
  const [, setLocation] = useLocation();
  const { refreshAuth } = useAuth();

  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "register") {
        await registerUser(email, password);
      } else {
        await loginUser(email, password);
      }
      await refreshAuth();
      setLocation("/dashboard");
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const isRegister = mode === "register";

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-primary">
            TERMINAL<span className="text-muted-foreground">/01</span>
          </h1>
          <p className="text-muted-foreground text-sm uppercase tracking-widest">
            {isRegister ? "Create Operator Account" : "Authorized Personnel Only"}
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-card border border-border p-8 rounded-lg shadow-sm space-y-6"
        >
          <div className="space-y-4">
            <div className="space-y-2">
              <Label
                htmlFor="email"
                className="text-xs uppercase tracking-wider text-muted-foreground"
              >
                Operator ID
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="operator@system.local"
                required
                autoComplete="email"
                className="font-mono bg-background border-border focus-visible:ring-primary"
              />
            </div>

            <div className="space-y-2">
              <Label
                htmlFor="password"
                className="text-xs uppercase tracking-wider text-muted-foreground"
              >
                Passcode
              </Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={isRegister ? 8 : undefined}
                autoComplete={isRegister ? "new-password" : "current-password"}
                className="font-mono bg-background border-border focus-visible:ring-primary"
              />
              {isRegister && (
                <p className="text-[11px] text-muted-foreground font-mono">
                  Minimum 8 characters.
                </p>
              )}
            </div>
          </div>

          {error && (
            <div
              id="auth-error"
              role="alert"
              className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
            >
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <Button
            type="submit"
            disabled={submitting}
            className="w-full font-bold tracking-wider"
          >
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isRegister ? "CREATE ACCOUNT" : "AUTHENTICATE"}
          </Button>

          <div className="text-center text-xs text-muted-foreground">
            {isRegister ? "Already have an account?" : "Need an account?"}{" "}
            <button
              type="button"
              onClick={() => {
                setMode(isRegister ? "login" : "register");
                setError(null);
              }}
              className="text-primary hover:underline font-medium"
            >
              {isRegister ? "Sign in" : "Register"}
            </button>
          </div>
        </form>

        <p className="text-center text-xs text-muted-foreground/70 font-mono">
          <Link href="/dashboard" className="hover:text-primary hover:underline">
            Continue in demo mode →
          </Link>
        </p>
      </div>
    </div>
  );
}
