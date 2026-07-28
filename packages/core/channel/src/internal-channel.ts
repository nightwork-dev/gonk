// @gonk/channel/base — InternalChannel + createInternalChannelPair: the loopback
// reference impl of the channel
// contract and the conformance-test fixture. Uses gonk's tiny Emitter, not
// node:events; ids come from createMessage's portable uuid path.

import { BaseChannel } from "./base-channel.ts";
import { Emitter } from "./emitter.ts";
import { createMessage } from "./message.ts";
import type {
  ChannelCapabilities,
  ChannelEvent,
  ConnectAddress,
  Message,
} from "./types.ts";

export interface InternalChannelPair {
  channelA: InternalChannel;
  channelB: InternalChannel;
}

let pairCounter = 0;

/** Create a linked, initially disconnected loopback pair. A's `send` is
 *  delivered to B's `onMessage` and vice versa; same for events. */
export function createInternalChannelPair(options?: {
  idA?: string;
  idB?: string;
  capabilities?: Partial<ChannelCapabilities>;
}): InternalChannelPair {
  const bus = new Emitter();
  const seq = pairCounter++;
  const idA = options?.idA ?? `internal-${seq}-a`;
  const idB = options?.idB ?? `internal-${seq}-b`;
  const caps: ChannelCapabilities = {
    markdown: true,
    images: false,
    audio: false,
    reactions: true,
    threads: true,
    typing: true,
    editing: true,
    deletion: true,
    files: false,
    groups: false,
    richEmbeds: false,
    ...options?.capabilities,
  };

  const channelA = new InternalChannel(idA, bus, "a-to-b", "b-to-a", caps);
  const channelB = new InternalChannel(idB, bus, "b-to-a", "a-to-b", caps);

  return { channelA, channelB };
}

export class InternalChannel extends BaseChannel {
  readonly type = "internal";
  private connected = false;

  constructor(
    readonly id: string,
    private bus: Emitter,
    private sendChannel: string,
    private receiveChannel: string,
    readonly capabilities: ChannelCapabilities,
  ) {
    super();
  }

  async send(partial: Omit<Message, "id" | "timestamp">): Promise<Message> {
    if (!this.connected) throw new Error("Channel not connected");
    const message = createMessage(partial);
    this.bus.emit(this.sendChannel, message);
    return message;
  }

  onMessage(handler: (message: Message) => void): () => void {
    return this.bus.on<Message>(this.receiveChannel, handler);
  }

  onEvent(handler: (event: ChannelEvent) => void): () => void {
    return this.bus.on<ChannelEvent>(`event:${this.receiveChannel}`, handler);
  }

  async connect(): Promise<void> {
    this.setConnectionState("connecting");
    this.connected = true;
    this.setConnectionState("connected");
    this.bus.emit<ChannelEvent>(`event:${this.sendChannel}`, {
      type: "connected",
      channelId: this.id,
    });
  }

  async disconnect(): Promise<void> {
    this.setConnectionState("disconnecting");
    this.connected = false;
    this.setConnectionState("disconnected");
    this.bus.emit<ChannelEvent>(`event:${this.sendChannel}`, {
      type: "disconnected",
      channelId: this.id,
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  override async sendReaction(
    messageId: string,
    to: ConnectAddress,
    reaction: string,
  ): Promise<void> {
    if (!this.connected) return;
    this.bus.emit<ChannelEvent>(`event:${this.sendChannel}`, {
      type: "reaction",
      channelId: this.id,
      messageId,
      emoji: reaction,
      userId: to.persona,
    });
  }

  override async sendTypingIndicator(to: ConnectAddress, _durationMs?: number): Promise<void> {
    if (!this.connected) return;
    this.bus.emit<ChannelEvent>(`event:${this.sendChannel}`, {
      type: "typing",
      channelId: this.id,
      userId: to.persona,
    });
  }
}
