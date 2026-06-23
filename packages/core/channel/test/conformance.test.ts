import { channelConformance } from "../src/index.ts";
import { createInternalChannelPair } from "../src/base.ts";
import type { ConnectAddress } from "../src/index.ts";

const addrA: ConnectAddress = { host: "studio", persona: "nova" };
const addrB: ConnectAddress = { host: "studio", persona: "wren" };

// Run the public conformance suite against a real InternalChannel loopback pair.
channelConformance(() => {
  const { channelA, channelB } = createInternalChannelPair();
  return {
    local: channelA,
    peer: channelB,
    localAddress: addrA,
    peerAddress: addrB,
  };
});
