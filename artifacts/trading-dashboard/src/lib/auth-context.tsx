import { createContext, useContext, useCallback, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@workspace/api-client-react";
import { fetchCurrentUser, logoutUser, type AuthUser } from "@/lib/auth-api";
import { CACHE_VERSION } from "@/lib/trading-api";

const AUTH_QUERY_KEY = [CACHE_VERSION, "/api/auth/me"];

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  /** Re-fetch /me and all session-scoped data (call after login/register). */
  refreshAuth: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: AUTH_QUERY_KEY,
    queryFn: fetchCurrentUser,
    // A 401 simply means "anonymous / expired session" — not a real error to
    // retry. Any other failure also resolves to anonymous mode.
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status === 401) return false;
      return failureCount < 1;
    },
    staleTime: 30_000,
  });

  const user = data ?? null;

  // Session-scoped queries that should refresh whenever auth state changes so
  // user-specific data (AI trades, notifications) appears or reverts to demo.
  const invalidateSessionData = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: [CACHE_VERSION, "/api/ai/trades"] });
    queryClient.invalidateQueries({ queryKey: [CACHE_VERSION, "/api/notifications"] });
    queryClient.invalidateQueries({ queryKey: [CACHE_VERSION, "/api/analytics/portfolio"] });
    queryClient.invalidateQueries({ queryKey: [CACHE_VERSION, "/api/risk"] });
  }, [queryClient]);

  const refreshAuth = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: AUTH_QUERY_KEY });
    invalidateSessionData();
  }, [queryClient, invalidateSessionData]);

  const logout = useCallback(async () => {
    try {
      await logoutUser();
    } finally {
      queryClient.setQueryData(AUTH_QUERY_KEY, null);
      await queryClient.invalidateQueries({ queryKey: AUTH_QUERY_KEY });
      invalidateSessionData();
    }
  }, [queryClient, invalidateSessionData]);

  const value: AuthContextValue = {
    user,
    isLoading,
    isAuthenticated: user !== null,
    refreshAuth,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
