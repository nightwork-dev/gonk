// @gonk/channel (root) — the transport contract, the address, the message.
// Client-safe: pure types + Standard Schema shapes, ZERO zod, ZERO node built-ins.
// gonk-native identity: routing carries a ConnectAddress on the message, not a flat
// channelId/peerId. Grounding: docs/connectivity/00-grounding.md §1.

import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { ScopeName } from "@gonk/scope";
import { shape } from "@gonk/tool-registry/shape";

export type { ScopeName };

// ── Address ─────────────────────────────────────────────────────────────────
// Net-new (grounding §0.4): no composite address type exists in gonk. Assembled
// from host + persona id + ScopeName. There is no flat agentId/peerId.

/** Who a message is from/to. `host` is opaque to @gonk/channel — a transport
 *  interprets it (a websocket URL on the tailnet, a Signal recipient, …). The
 *  address names *who*; the bus resolves *which* persona via PersonaRegistry. */
export interface ConnectAddress {
  /** A tailnet host / node name; "" or "local" = this host. */
  host: string;
  /** Persona id (PersonaRegistry id), NOT a free agentId. */
  persona: string;
  /** Optional tier the conversation is bound to; default "session". */
  scope?: ScopeName;
}

// ── Content parts ─────────────────────────────────────────────────────────────
// Inbound content union (adapted from content.ts:48-55). Inbound parts carry a
// `url`; outbound parts carry raw bytes (OutboundPart, below). Keep them separate.

export interface TextContent {
  type: "text";
  text: string;
}

export interface ImageContent {
  type: "image";
  url: string;
  mimeType: string;
  width?: number;
  height?: number;
  caption?: string;
}

export interface AudioContent {
  type: "audio";
  url: string;
  mimeType: string;
  durationSeconds?: number;
  isVoiceMessage?: boolean;
  transcription?: string;
}

export interface FileContent {
  type: "file";
  url: string;
  mimeType: string;
  filename: string;
  sizeBytes?: number;
}

export interface ReactionContent {
  type: "reaction";
  emoji: string;
  targetMessageId: string;
  added?: boolean;
}

/** Inbound content union. */
export type ContentPart =
  | TextContent
  | ImageContent
  | AudioContent
  | FileContent
  | ReactionContent;

/** Outbound content (adapted from content.ts:68-74). `source` is raw bytes as a
 *  Uint8Array (NOT Buffer — keeps the root entry client-safe) or a string. */
export type OutboundPart =
  | { type: "text"; text: string }
  | { type: "image"; source: Uint8Array | string; mimeType: string; caption?: string }
  | { type: "audio"; source: Uint8Array | string; mimeType: string; asVoiceMessage?: boolean }
  | { type: "file"; source: Uint8Array | string; mimeType: string; filename: string };

// ── Message ───────────────────────────────────────────────────────────────────
// channelId/peerId are gone; from/to carry the
// address. id/timestamp are filled imperatively in createMessage (§2 of the spec).

export interface Message {
  id: string;
  /** Sender as an address (replaces the flat peerId sender). */
  from: ConnectAddress;
  /** Destination as an address (replaces channelId + routing). */
  to: ConnectAddress;
  content: ContentPart[];
  timestamp: number;
  /** The multi-party conversation key (the thread id). */
  conversationId?: string;
  replyTo?: string;
  /** Whether this message originates from a group channel. */
  isGroup?: boolean;
  /** Whether the agent was explicitly mentioned (e.g. @mention). */
  isMentioned?: boolean;
  /** Transport-specific details (Signal recipient, ws clientId). NEVER trusted
   *  for routing — the authoritative `from` is the transport's authenticated
   *  identity, reconciled at ingest. */
  transportMeta?: Record<string, unknown>;
}

// ── Channel capabilities / state / events / errors ───────────────────────────
// Plain TS capability / state / event / error shapes.

export interface ChannelCapabilities {
  markdown: boolean;
  images: boolean;
  audio: boolean;
  reactions: boolean;
  threads: boolean;
  typing: boolean;
  editing: boolean;
  deletion: boolean;
  files: boolean;
  groups: boolean;
  richEmbeds: boolean;
  maxMessageLength?: number;
  maxFileSize?: number;
  supportedMediaTypes?: string[];
}

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "authenticating"
  | "connected"
  | "reconnecting"
  | "disconnecting"
  | "error";

export interface ChannelError {
  code: string;
  message: string;
  recoverable: boolean;
  /** The underlying transport error, if any. */
  cause?: unknown;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export type ChannelEvent =
  | { type: "typing"; channelId: string; userId: string }
  | { type: "presence"; channelId: string; userId: string; status: string }
  | { type: "reaction"; channelId: string; messageId: string; emoji: string; userId: string }
  | { type: "connected"; channelId: string }
  | { type: "disconnected"; channelId: string; reason?: string }
  | { type: "message_edited"; channelId: string; messageId: string; newContent: string; userId: string }
  | { type: "message_deleted"; channelId: string; messageId: string; userId: string }
  | { type: "peer_join"; channelId: string; peerId: string; metadata?: Record<string, unknown> }
  | { type: "peer_leave"; channelId: string; peerId: string; reason?: string }
  | { type: "error"; channelId: string; error: ChannelError };

// ── The transport contract ───────────────────────────────────────────────────
// The transport contract: peerId: string args are replaced by to: ConnectAddress.
// accountId dropped (deferred, spec §6).

/** Known channel types. Extensible via string literals for custom transports. */
export type ChannelType = "websocket" | "signal" | "internal" | (string & {});

export interface IChannel {
  readonly id: string;
  readonly type: ChannelType;
  readonly capabilities: ChannelCapabilities;

  send(message: Omit<Message, "id" | "timestamp">): Promise<Message>;
  onMessage(handler: (message: Message) => void): () => void;
  onEvent(handler: (event: ChannelEvent) => void): () => void;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
}

export interface IExtendedChannel extends IChannel {
  getConnectionState(): ConnectionState;
  onConnectionStateChange(handler: (prev: ConnectionState, next: ConnectionState) => void): () => void;
  onError(handler: (error: ChannelError) => void): () => void;

  /** Optional capability ops — default to no-op in BaseChannel. */
  sendReaction(messageId: string, to: ConnectAddress, reaction: string): Promise<void>;
  sendTypingIndicator(to: ConnectAddress, durationMs?: number): Promise<void>;
}

// ── Standard Schema shapes ────────────────────────────────────────────────────
// In-tree shape() adapter (tool-registry/shape) — zero schema-library deps.
// These guard runtime input; the imperative normalize lives in createMessage.

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function isContentPart(v: unknown): v is ContentPart {
  if (!isObj(v)) return false;
  switch (v.type) {
    case "text":
      return typeof v.text === "string";
    case "image":
    case "audio":
      return typeof v.url === "string" && typeof v.mimeType === "string";
    case "file":
      return (
        typeof v.url === "string" &&
        typeof v.mimeType === "string" &&
        typeof v.filename === "string"
      );
    case "reaction":
      return typeof v.emoji === "string" && typeof v.targetMessageId === "string";
    default:
      return false;
  }
}

/** Standard Schema for a single inbound ContentPart. */
export const ContentPartSchema: StandardSchemaV1<unknown, ContentPart> = shape<ContentPart>(
  isContentPart,
  "expected a ContentPart (text | image | audio | file | reaction)",
);

function isAddress(v: unknown): v is ConnectAddress {
  return isObj(v) && typeof v.host === "string" && typeof v.persona === "string";
}

/** Standard Schema for a ConnectAddress. */
export const ConnectAddressSchema: StandardSchemaV1<unknown, ConnectAddress> = shape<ConnectAddress>(
  isAddress,
  "expected a ConnectAddress { host: string; persona: string; scope? }",
);

/** The createMessage input shape: address from/to, content as string OR parts. */
export interface MessageInput {
  from: ConnectAddress;
  to: ConnectAddress;
  content: string | ContentPart[];
  id?: string;
  timestamp?: number;
  conversationId?: string;
  replyTo?: string;
  isGroup?: boolean;
  isMentioned?: boolean;
  transportMeta?: Record<string, unknown>;
}

function isMessageInput(v: unknown): v is MessageInput {
  if (!isObj(v)) return false;
  if (!isAddress(v.from) || !isAddress(v.to)) return false;
  if (typeof v.content === "string") return true;
  return Array.isArray(v.content) && v.content.every(isContentPart);
}

/** Standard Schema for createMessage input (string content allowed; normalized
 *  imperatively in createMessage, NOT via a schema transform). */
export const MessageInputSchema: StandardSchemaV1<unknown, MessageInput> = shape<MessageInput>(
  isMessageInput,
  "expected a message input { from, to: ConnectAddress; content: string | ContentPart[] }",
);
