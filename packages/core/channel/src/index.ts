// @gonk/channel (root entry) — client-safe: types + createMessage + registry +
// address helpers + the conformance suite factory. No barrel; explicit named
// re-exports, type-only split from value. Server-leaning impls (BaseChannel,
// InternalChannel, ReconnectionManager) live behind @gonk/channel/base.

export type {
  ConnectAddress,
  ScopeName,
  ChannelType,
  IChannel,
  IExtendedChannel,
  Message,
  MessageInput,
  ContentPart,
  TextContent,
  ImageContent,
  AudioContent,
  FileContent,
  ReactionContent,
  OutboundPart,
  ChannelCapabilities,
  ConnectionState,
  ChannelEvent,
  ChannelError,
} from "./types.ts";
export { ContentPartSchema, ConnectAddressSchema, MessageInputSchema } from "./types.ts";

export { createMessage, extractText, parseAddress, formatAddress } from "./message.ts";

export type { IChannelRegistry } from "./registry.ts";
export { ChannelRegistry } from "./registry.ts";

