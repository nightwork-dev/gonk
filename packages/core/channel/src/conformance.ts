// @gonk/channel — the runner-neutral conformance suite factory (spec §8). A
// transport package adapts its test runner and runs the suite against its own
// channel to assert the IChannel contract.

import type { ConnectAddress, IChannel, Message } from "./types.ts";

/** A factory yielding a connected loopback: `local` is the channel under test;
 *  `peer` is the other end, used to drive inbound delivery. Both are
 *  disconnected on return; the suite connects them. `from`/`to` name the two
 *  ends' addresses for message construction. */
export interface ConformancePair {
  local: IChannel;
  peer: IChannel;
  /** Address of `local` (the `to` for messages the peer sends inbound). */
  localAddress: ConnectAddress;
  /** Address of `peer` (the `to` for messages `local` sends outbound). */
  peerAddress: ConnectAddress;
}

export interface ChannelConformanceRunner {
  describe(name: string, suite: () => void): void;
  test(name: string, test: () => void | Promise<void>): void;
}

/** Run the IChannel conformance suite against a channel implementation. The
 *  factory must return a FRESH disconnected pair per invocation. */
export function channelConformance(
  makeChannel: () => ConformancePair,
  runner: ChannelConformanceRunner
): void {
  runner.describe("IChannel conformance", () => {
    runner.test(
      "connect() flips isConnected() to true; disconnect() flips it back",
      async () => {
        const { local } = makeChannel();
        assert(!local.isConnected(), "channel started connected");
        await local.connect();
        assert(local.isConnected(), "connect() did not connect the channel");
        await local.disconnect();
        assert(!local.isConnected(), "disconnect() did not disconnect the channel");
      }
    );

    runner.test("send() returns a Message with filled id and timestamp", async () => {
      const { local, peer, localAddress, peerAddress } = makeChannel();
      await local.connect();
      await peer.connect();
      const before = Date.now();
      const msg = await local.send({
        from: localAddress,
        to: peerAddress,
        content: [{ type: "text", text: "hi" }],
      });
      assert(typeof msg.id === "string", "send() returned a non-string id");
      assert(msg.id.length > 0, "send() returned an empty id");
      assert(typeof msg.timestamp === "number", "send() returned a non-number timestamp");
      assert(msg.timestamp >= before, "send() returned a stale timestamp");
    });

    runner.test(
      "onMessage fires on a loopback peer's send; unsubscribe stops it",
      async () => {
        const { local, peer, localAddress, peerAddress } = makeChannel();
        await local.connect();
        await peer.connect();

        const received: Message[] = [];
        const unsubscribe = local.onMessage((m) => received.push(m));

        await peer.send({
          from: peerAddress,
          to: localAddress,
          content: [{ type: "text", text: "first" }],
        });
        assert(received.length === 1, "onMessage did not receive the peer message");
        equal(received[0]?.content, [{ type: "text", text: "first" }]);

        unsubscribe();
        await peer.send({
          from: peerAddress,
          to: localAddress,
          content: [{ type: "text", text: "second" }],
        });
        assert(received.length === 1, "unsubscribe did not stop delivery");
      }
    );

    runner.test("connection-state transitions emit prev/next pairs", async () => {
      const { local } = makeChannel();
      const ext = local as IChannel & {
        onConnectionStateChange?: (
          h: (prev: string, next: string) => void,
        ) => () => void;
      };
      // BaseChannel-derived channels expose onConnectionStateChange; guard for
      // a minimal IChannel that does not.
      if (typeof ext.onConnectionStateChange !== "function") return;
      const transitions: Array<[string, string]> = [];
      ext.onConnectionStateChange((prev, next) => transitions.push([prev, next]));
      await local.connect();
      assert(
        includesPair(transitions, ["disconnected", "connecting"]),
        "missing disconnected-to-connecting transition"
      );
      assert(
        includesPair(transitions, ["connecting", "connected"]),
        "missing connecting-to-connected transition"
      );
    });

    runner.test("default capability ops resolve without throwing", async () => {
      const { local, peerAddress } = makeChannel();
      await local.connect();
      const ext = local as IChannel & {
        sendReaction?: (id: string, to: ConnectAddress, r: string) => Promise<void>;
        sendTypingIndicator?: (to: ConnectAddress, ms?: number) => Promise<void>;
      };
      if (typeof ext.sendReaction === "function") {
        const result = await ext.sendReaction("m1", peerAddress, "👍");
        assert(result === undefined, "sendReaction() did not resolve to undefined");
      }
      if (typeof ext.sendTypingIndicator === "function") {
        const result = await ext.sendTypingIndicator(peerAddress);
        assert(result === undefined, "sendTypingIndicator() did not resolve to undefined");
      }
    });
  });
}

function includesPair(
  pairs: ReadonlyArray<readonly [string, string]>,
  expected: readonly [string, string]
): boolean {
  return pairs.some(([previous, next]) => {
    return previous === expected[0] && next === expected[1];
  });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Channel conformance: ${message}`);
}

function equal(actual: unknown, expected: unknown): void {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`
  );
}
