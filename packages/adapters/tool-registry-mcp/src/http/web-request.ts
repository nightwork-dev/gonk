import type { WebMcpHandlerOptions } from "./web.ts";

/** Apply the same Host and Origin checks to MCP and JSON before dispatch. */
export function protectRequest(
  request: Request,
  options: WebMcpHandlerOptions
): Response | undefined {
  if (!options.enableDnsRebindingProtection) return undefined;
  const host = request.headers.get("host");
  if (options.allowedHosts?.length && (!host || !options.allowedHosts.includes(host))) {
    return jsonError(403, -32000, `Invalid Host header: ${host}`);
  }
  const origin = request.headers.get("origin");
  if (origin && options.allowedOrigins?.length && !options.allowedOrigins.includes(origin)) {
    return jsonError(403, -32000, `Invalid Origin header: ${origin}`);
  }
  return undefined;
}

export class BodyTooLargeError extends Error {}

export async function boundedJson(
  request: Request,
  maxBytes: number
): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes)
    throw new BodyTooLargeError();
  if (!request.body) return undefined;

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        // A mounted framework may supply one branch of a tee. Its cancellation
        // can stay pending until the other branch finishes.
        void reader.cancel().catch(() => {});
        throw new BodyTooLargeError();
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text ? JSON.parse(text) : undefined;
  } finally {
    reader.releaseLock();
  }
}

export function jsonError(
  status: number,
  code: number,
  message: string,
  headers?: Record<string, string>
): Response {
  return Response.json(
    { jsonrpc: "2.0", error: { code, message }, id: null },
    { status, ...(headers ? { headers } : {}) }
  );
}
