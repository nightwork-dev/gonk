// @gonk/channel — the conformance suite factory (spec §8). A transport package
// (transport-websocket / transport-signal) imports `channelConformance` and runs
// it against its own channel to assert the IChannel contract. This package runs
// it against an InternalChannel pair. Importing `vitest` here keeps the test DSL
// out of the runtime types/registry surface; tsup marks vitest external (devDep).

import { describe, expect, it } from "vitest";
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

/** Run the IChannel conformance suite against a channel implementation. The
 *  factory must return a FRESH disconnected pair per invocation. */
export function channelConformance(makeChannel: () => ConformancePair): void {
  describe("IChannel conformance", () => {
    it("connect() flips isConnected() to true; disconnect() flips it back", async () => {
      const { local } = makeChannel();
      expect(local.isConnected()).toBe(false);
      await local.connect();
      expect(local.isConnected()).toBe(true);
      await local.disconnect();
      expect(local.isConnected()).toBe(false);
    });

    it("send() returns a Message with filled id and timestamp", async () => {
      const { local, peer, localAddress, peerAddress } = makeChannel();
      await local.connect();
      await peer.connect();
      const before = Date.now();
      const msg = await local.send({
        from: localAddress,
        to: peerAddress,
        content: [{ type: "text", text: "hi" }],
      });
      expect(typeof msg.id).toBe("string");
      expect(msg.id.length).toBeGreaterThan(0);
      expect(typeof msg.timestamp).toBe("number");
      expect(msg.timestamp).toBeGreaterThanOrEqual(before);
    });

    it("onMessage fires on a loopback peer's send; unsubscribe stops it", async () => {
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
      expect(received).toHaveLength(1);
      expect(received[0]?.content).toEqual([{ type: "text", text: "first" }]);

      unsubscribe();
      await peer.send({
        from: peerAddress,
        to: localAddress,
        content: [{ type: "text", text: "second" }],
      });
      expect(received).toHaveLength(1); // unsubscribe stopped delivery
    });

    it("connection-state transitions emit prev/next pairs", async () => {
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
      expect(transitions).toContainEqual(["disconnected", "connecting"]);
      expect(transitions).toContainEqual(["connecting", "connected"]);
    });

    it("default capability ops resolve without throwing", async () => {
      const { local, peerAddress } = makeChannel();
      await local.connect();
      const ext = local as IChannel & {
        sendReaction?: (id: string, to: ConnectAddress, r: string) => Promise<void>;
        sendTypingIndicator?: (to: ConnectAddress, ms?: number) => Promise<void>;
      };
      if (typeof ext.sendReaction === "function") {
        await expect(ext.sendReaction("m1", peerAddress, "👍")).resolves.toBeUndefined();
      }
      if (typeof ext.sendTypingIndicator === "function") {
        await expect(ext.sendTypingIndicator(peerAddress)).resolves.toBeUndefined();
      }
    });
  });
}
