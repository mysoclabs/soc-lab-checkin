import { getRequest } from "@tanstack/react-start/server";

// Split out from login.functions.ts: that module is statically imported by
// auth.tsx (a client route) for loginWithLockout, so any top-level import of
// "@tanstack/react-start/server" there trips TanStack Start's client-bundle
// import-protection even though the code only ever runs inside a server
// function handler. Living in its own .server.ts file and being reached only
// via dynamic `await import(...)` inside handlers (same pattern as
// client.server.ts) keeps it out of the client bundle entirely.
export function getClientIp(): string | null {
  const request = getRequest();
  const headers = request?.headers;
  if (!headers) return null;
  return (
    headers.get("cf-connecting-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    null
  );
}
