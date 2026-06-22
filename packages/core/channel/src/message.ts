// @gonk/channel (root) — message construction, text extraction, address codec.
// Client-safe: no node:* imports. createMessage fills id/timestamp and normalizes
// string content imperatively (spec §2/§3) — NOT via a Standard Schema transform.

import type { ConnectAddress, ContentPart, Message, MessageInput, ScopeName } from "./types.ts";

const SCOPE_NAMES: readonly ScopeName[] = [
  "global",
  "persona",
  "project",
  "directory",
  "session",
];

/** Portable UUID. Uses the platform `crypto.randomUUID` (Node ≥19, browsers)
 *  when present; falls back to an RFC4122-v4-shaped string otherwise. Keeps the
 *  root entry free of `node:crypto` so it stays client-safe. */
function portableUuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Fallback: not cryptographically strong, but a valid v4 shape for ids.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Construct a Message from a partial: fills `id` (a portable uuid) and
 *  `timestamp`, and
 *  normalizes string content to `[{ type: "text", text }]`. */
export function createMessage(input: MessageInput): Message {
  const content: ContentPart[] =
    typeof input.content === "string"
      ? [{ type: "text", text: input.content }]
      : input.content;

  const message: Message = {
    id: input.id ?? portableUuid(),
    from: input.from,
    to: input.to,
    content,
    timestamp: input.timestamp ?? Date.now(),
  };
  // exactOptionalPropertyTypes is ON — only assign optionals when defined.
  if (input.conversationId !== undefined) message.conversationId = input.conversationId;
  if (input.replyTo !== undefined) message.replyTo = input.replyTo;
  if (input.isGroup !== undefined) message.isGroup = input.isGroup;
  if (input.isMentioned !== undefined) message.isMentioned = input.isMentioned;
  if (input.transportMeta !== undefined) message.transportMeta = input.transportMeta;
  return message;
}

/** Concatenate all text parts with newlines (adapts content.ts:84-89). */
export function extractText(parts: ContentPart[]): string {
  return parts
    .filter((p): p is Extract<ContentPart, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}

// ── Address codec ─────────────────────────────────────────────────────────────
// Canonical string form `persona@host`, with `#scope` appended when the scope is
// present and not "session". parseAddress/formatAddress round-trip.

function isScopeName(s: string): s is ScopeName {
  return (SCOPE_NAMES as readonly string[]).includes(s);
}

/** Format a ConnectAddress to its canonical string `persona@host[#scope]`. */
export function formatAddress(address: ConnectAddress): string {
  const base = `${address.persona}@${address.host}`;
  if (address.scope !== undefined && address.scope !== "session") {
    return `${base}#${address.scope}`;
  }
  return base;
}

/** Parse a canonical address string `persona@host[#scope]` to a ConnectAddress.
 *  Throws on a malformed string. The default scope is "session" (left implicit:
 *  the parsed address omits `scope` when "session", so format→parse→format is
 *  stable). */
export function parseAddress(s: string): ConnectAddress {
  const hashIdx = s.indexOf("#");
  const head = hashIdx === -1 ? s : s.slice(0, hashIdx);
  const scopePart = hashIdx === -1 ? undefined : s.slice(hashIdx + 1);

  const at = head.indexOf("@");
  if (at <= 0 || at === head.length - 1) {
    throw new Error(`invalid address: ${JSON.stringify(s)} (expected "persona@host[#scope]")`);
  }
  const persona = head.slice(0, at);
  const host = head.slice(at + 1);
  if (host.includes("@")) {
    throw new Error(`invalid address: ${JSON.stringify(s)} (host must not contain "@")`);
  }

  const address: ConnectAddress = { host, persona };
  if (scopePart !== undefined) {
    if (!isScopeName(scopePart)) {
      throw new Error(`invalid address scope: ${JSON.stringify(scopePart)}`);
    }
    if (scopePart !== "session") address.scope = scopePart;
  }
  return address;
}
