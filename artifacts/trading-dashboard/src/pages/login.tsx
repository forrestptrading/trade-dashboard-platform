import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link, useLocation } from "wouter";

export default function Login() {
  const [, setLocation] = useLocation();

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setLocation("/dashboard");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-primary">TERMINAL<span className="text-muted-foreground">/01</span></h1>
          <p className="text-muted-foreground text-sm uppercase tracking-widest">Authorized Personnel Only</p>
        </div>

        <form onSubmit={handleLogin} className="bg-card border border-border p-8 rounded-lg shadow-sm space-y-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-xs uppercase tracking-wider text-muted-foreground">Operator ID</Label>
              <Input 
                id="email" 
                type="email" 
                placeholder="operator@system.local" 
                required 
                className="font-mono bg-background border-border focus-visible:ring-primary"
              />
            </div>
            
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-xs uppercase tracking-wider text-muted-foreground">Passcode</Label>
                <Link href="#" className="text-xs text-primary hover:underline">Reset?</Link>
              </div>
              <Input 
                id="password" 
                type="password" 
                required 
                className="font-mono bg-background border-border focus-visible:ring-primary"
              />
            </div>
          </div>

          <Button type="submit" className="w-full font-bold tracking-wider">
            AUTHENTICATE
          </Button>
        </form>
        
        <p className="text-center text-xs text-muted-foreground/50 font-mono">
          {new Date().toISOString()}
        </p>
      </div>
    </div>
  );
}
