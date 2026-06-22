import { describe, expect, it } from "vitest";
import { ChannelRegistry } from "../src/index.ts";
import { createInternalChannelPair } from "../src/base.ts";

describe("ChannelRegistry", () => {
  it("registers and retrieves a channel by id", () => {
    const reg = new ChannelRegistry();
    const { channelA } = createInternalChannelPair({ idA: "chan-1" });
    reg.register(channelA);
    expect(reg.get("chan-1")).toBe(channelA);
  });

  it("throws on a duplicate id", () => {
    const reg = new ChannelRegistry();
    const { channelA } = createInternalChannelPair({ idA: "dup" });
    const { channelA: other } = createInternalChannelPair({ idA: "dup" });
    reg.register(channelA);
    expect(() => reg.register(other)).toThrow(/already registered/);
  });

  it("getByType returns all channels of a type", () => {
    const reg = new ChannelRegistry();
    const { channelA, channelB } = createInternalChannelPair({ idA: "a", idB: "b" });
    reg.register(channelA);
    reg.register(channelB);
    const internal = reg.getByType("internal");
    expect(internal).toHaveLength(2);
    expect(reg.getByType("websocket")).toHaveLength(0);
  });

  it("unregister removes a channel; list reflects the set", () => {
    const reg = new ChannelRegistry();
    const { channelA, channelB } = createInternalChannelPair({ idA: "x", idB: "y" });
    reg.register(channelA);
    reg.register(channelB);
    expect(reg.list()).toHaveLength(2);
    reg.unregister("x");
    expect(reg.get("x")).toBeUndefined();
    expect(reg.list()).toHaveLength(1);
  });
});
