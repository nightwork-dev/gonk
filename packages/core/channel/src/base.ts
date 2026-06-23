// @gonk/channel/base (subpath entry) — the server-leaning impls: the abstract
// BaseChannel, the InternalChannel loopback reference impl + its pair factory,
// and the ReconnectionManager. Node-built-in-free (a tiny internal Emitter
// replaces node:events). No barrel; explicit named re-exports, type/value split.

export { BaseChannel } from "./base-channel.ts";
export { InternalChannel, createInternalChannelPair } from "./internal-channel.ts";
export type { InternalChannelPair } from "./internal-channel.ts";
export { ReconnectionManager } from "./reconnection.ts";
export type {
  ReconnectionConfig,
  ReconnectionDeps,
  ReconnectionState,
  CircuitState,
} from "./reconnection.ts";
