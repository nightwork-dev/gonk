import { timingSafeEqual } from "node:crypto";

/** Constant-time string equality; false on length mismatch without branching on
 *  content. Never logs either operand. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

function bearerFromHeader(authorization: string | undefined): string | undefined {
  if (!authorization) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return m ? m[1] : undefined;
}

/**
 * Header-only bearer auth check. A configured `apiKey` requires
 * `Authorization: Bearer <key>`. When `apiKey` is unconfigured, every request
 * passes (trusted-network / keyless mode). The key is never returned or logged.
 */
export function checkBearer(
  authorization: string | undefined,
  apiKey: string | undefined,
): boolean {
  if (!apiKey) return true; // keyless
  const presented = bearerFromHeader(authorization);
  if (!presented) return false;
  return safeEqual(presented, apiKey);
}
