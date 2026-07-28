# @gonk/channel

The connectivity-layer transport contract for gonk: the `IChannel` / `BaseChannel` interfaces, the address-on-the-message `Message` + `ContentPart` (on Standard Schema), the `persona@host#scope` `ConnectAddress`, a `ChannelRegistry`, an `InternalChannel` loopback reference implementation, and a `ReconnectionManager`. Harness-agnostic and free of `zod` — transports (`transport-websocket`, `transport-signal`, …) implement `IChannel` and run the shared conformance suite.

## Entry points

```ts
// Root — client-safe: types + message/address helpers + the registry.
// No node:* imports; safe for browser/worker clients.
import {
  ChannelRegistry,
  createMessage,
  extractText,
  parseAddress,
  formatAddress,
  ContentPartSchema,
  ConnectAddressSchema,
  MessageInputSchema,
} from "@gonk/channel";
import type {
  IChannel,
  Message,
  ContentPart,
  ConnectAddress,
  ChannelEvent,
  ChannelError,
} from "@gonk/channel";

// base — the server-leaning implementations.
import {
  BaseChannel,
  InternalChannel,
  createInternalChannelPair,
  ReconnectionManager,
} from "@gonk/channel/base";

// conformance — the runner-neutral IChannel contract suite.
import {
  channelConformance,
  type ChannelConformanceRunner,
} from "@gonk/channel/conformance";
```

## Addresses

A `ConnectAddress` is `persona@host` with an optional `#scope` (one of the five gonk scope tiers; `session` is the implicit default and round-trips stably):

```ts
import { parseAddress, formatAddress } from "@gonk/channel";

const addr = parseAddress("writer@pi#persona");
// → { host: "pi", persona: "writer", scope: "persona" }

formatAddress(addr); // "writer@pi#persona"
```

## Messages

`createMessage` fills `id` (a portable UUID) and `timestamp`, and normalizes a plain string into a single text part. `extractText` concatenates the text parts of a message.

```ts
import { createMessage, extractText } from "@gonk/channel";

const msg = createMessage({
  from: addr,
  to: peer,
  content: "hi",            // → [{ type: "text", text: "hi" }]
});
```

`ContentPart` covers `text`, `image`, `audio`, `file`, and `reaction`. The schemas (`ContentPartSchema`, `MessageInputSchema`, `ConnectAddressSchema`) are Standard Schema — validate with any compliant validator.

## Channels

`IChannel` is the transport contract: `connect()`, `disconnect()`, `isConnected()`, `send(input)` → `Message`, and `onMessage(handler)` → unsubscribe. `IExtendedChannel` adds connection-state transitions and capability ops (reactions, typing indicators). `BaseChannel` (in `@gonk/channel/base`) is the abstract base real transports extend; `InternalChannel` / `createInternalChannelPair` is an in-process loopback used for tests and reference; `ReconnectionManager` backs reconnect-with-circuit-breaker on top of a channel.

## Conformance

A transport package imports `channelConformance` and runs it against a fresh, disconnected channel pair to assert the `IChannel` contract holds:

```ts
import { channelConformance } from "@gonk/channel/conformance";
import { createInternalChannelPair } from "@gonk/channel/base";
import { describe, it } from "vitest";

channelConformance(
  () => {
    const { channelA: local, channelB: peer } = createInternalChannelPair({
      idA: "local",
      idB: "peer",
    });
    return {
      local,
      peer,
      localAddress: { host: "example", persona: "local" },
      peerAddress: { host: "example", persona: "peer" },
    };
  },
  {
    describe: (name, suite) => describe(name, suite),
    test: (name, test) => it(name, test),
  }
);
```

The adapter is deliberately tiny: use the equivalent suite and test functions
from Jest, `node:test`, or another runner without adding Vitest to production
dependencies.

## License

Apache-2.0.
