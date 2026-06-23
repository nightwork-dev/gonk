// @gonk/channel/base — the abstract BaseChannel.
// Subclasses implement id/type/capabilities/send/
// onMessage/onEvent/connect/disconnect/isConnected; the base provides the
// connection-state machine, the on* registrars, and default no-op capability
// methods so a minimal transport still satisfies IExtendedChannel. peerId args
// become to: ConnectAddress. node:events is gone — gonk's tiny Emitter handles
// fan-out where needed (subclasses); the base keeps handler arrays directly.

import type {
  ChannelCapabilities,
  ChannelError,
  ChannelEvent,
  ConnectAddress,
  ConnectionState,
  IExtendedChannel,
  Message,
} from "./types.ts";

export abstract class BaseChannel implements IExtendedChannel {
  abstract readonly id: string;
  abstract readonly type: string;
  abstract readonly capabilities: ChannelCapabilities;

  private connectionState: ConnectionState = "disconnected";
  private connectionStateHandlers: Array<(prev: ConnectionState, next: ConnectionState) => void> = [];
  private errorHandlers: Array<(error: ChannelError) => void> = [];

  abstract send(message: Omit<Message, "id" | "timestamp">): Promise<Message>;
  abstract onMessage(handler: (message: Message) => void): () => void;
  abstract onEvent(handler: (event: ChannelEvent) => void): () => void;
  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract isConnected(): boolean;

  protected setConnectionState(next: ConnectionState): void {
    const prev = this.connectionState;
    if (prev === next) return;
    this.connectionState = next;
    for (const handler of [...this.connectionStateHandlers]) handler(prev, next);
  }

  protected emitError(error: ChannelError): void {
    for (const handler of [...this.errorHandlers]) handler(error);
  }

  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  onConnectionStateChange(
    handler: (prev: ConnectionState, next: ConnectionState) => void,
  ): () => void {
    this.connectionStateHandlers.push(handler);
    return () => {
      const idx = this.connectionStateHandlers.indexOf(handler);
      if (idx >= 0) this.connectionStateHandlers.splice(idx, 1);
    };
  }

  onError(handler: (error: ChannelError) => void): () => void {
    this.errorHandlers.push(handler);
    return () => {
      const idx = this.errorHandlers.indexOf(handler);
      if (idx >= 0) this.errorHandlers.splice(idx, 1);
    };
  }

  // Default no-op capability ops so a minimal transport satisfies the rich
  // interface (adapts base-channel.ts:103-117). peerId → to: ConnectAddress.
  async sendReaction(_messageId: string, _to: ConnectAddress, _reaction: string): Promise<void> {
    // no-op by default
  }

  async sendTypingIndicator(_to: ConnectAddress, _durationMs?: number): Promise<void> {
    // no-op by default
  }
}
