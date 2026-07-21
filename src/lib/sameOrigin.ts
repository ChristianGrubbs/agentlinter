import { NextRequest } from "next/server";

// Blocks cross-origin POSTs (incl. DNS-rebinding against 127.0.0.1) to the
// state-changing local routes. Browsers always send Origin on cross-origin
// POST; a same-origin request either omits it or matches the Host.
export function isSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}
