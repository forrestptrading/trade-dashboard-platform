import { customFetch, ApiError } from "@workspace/api-client-react";

/**
 * Sprint 5 frontend auth layer for the backend auth endpoints
 * (POST /api/auth/register, /login, /logout, GET /api/auth/me).
 *
 * Session auth is cookie-based. The dashboard talks to `/api` through a
 * same-origin Vite proxy, so the session cookie is sent automatically; we also
 * pass `credentials: "include"` explicitly so it keeps working if the API is
 * ever served from a different origin.
 */

export interface AuthUser {
  id: string;
  email: string;
  created_at: string;
  last_login: string | null;
}

interface AuthEnvelope {
  success: boolean;
  data: { user: AuthUser };
}

/** Field-level validation errors returned by the backend (e.g. weak password). */
export interface AuthErrorBody {
  success: false;
  error: string;
  details?: Record<string, string[] | undefined>;
}

/**
 * Normalise any thrown error into a user-facing message. Maps the known
 * backend statuses (400 weak password / 409 duplicate email / 401 invalid
 * credentials or expired session) to friendly copy.
 */
export function authErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.data as AuthErrorBody | string | null;
    const fieldErrors =
      body && typeof body === "object" ? body.details : undefined;
    const passwordError = fieldErrors?.password?.[0];

    if (err.status === 400) {
      return passwordError ?? "Please enter a valid email and a password of at least 8 characters.";
    }
    if (err.status === 409) {
      return "An account with this email already exists.";
    }
    if (err.status === 401) {
      return "Invalid email or password.";
    }
    if (body && typeof body === "object" && typeof body.error === "string") {
      return body.error;
    }
    return "Something went wrong. Please try again.";
  }
  return "Network error. Please check your connection and try again.";
}

async function postAuth(path: string, body?: unknown): Promise<AuthEnvelope> {
  return customFetch<AuthEnvelope>(`/api/auth/${path}`, {
    method: "POST",
    credentials: "include",
    responseType: "json",
    body: body ? JSON.stringify(body) : undefined,
  });
}

export async function registerUser(email: string, password: string): Promise<AuthUser> {
  const res = await postAuth("register", { email, password });
  return res.data.user;
}

export async function loginUser(email: string, password: string): Promise<AuthUser> {
  const res = await postAuth("login", { email, password });
  return res.data.user;
}

export async function logoutUser(): Promise<void> {
  await customFetch(`/api/auth/logout`, {
    method: "POST",
    credentials: "include",
    responseType: "json",
  });
}

export async function fetchCurrentUser(): Promise<AuthUser> {
  const res = await customFetch<AuthEnvelope>(`/api/auth/me`, {
    method: "GET",
    credentials: "include",
    responseType: "json",
  });
  return res.data.user;
}
