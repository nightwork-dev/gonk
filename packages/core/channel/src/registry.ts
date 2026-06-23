// @gonk/channel (root) — in-memory channel registry: a Map keyed by channel id,
// throws on a duplicate id.

import type { ChannelType, IChannel } from "./types.ts";

export interface IChannelRegistry {
  register(channel: IChannel): void;
  unregister(channelId: string): void;
  get(channelId: string): IChannel | undefined;
  getByType(type: ChannelType): IChannel[];
  list(): IChannel[];
}

export class ChannelRegistry implements IChannelRegistry {
  private channels = new Map<string, IChannel>();

  register(channel: IChannel): void {
    if (this.channels.has(channel.id)) {
      throw new Error(`Channel ${channel.id} already registered`);
    }
    this.channels.set(channel.id, channel);
  }

  unregister(channelId: string): void {
    this.channels.delete(channelId);
  }

  get(channelId: string): IChannel | undefined {
    return this.channels.get(channelId);
  }

  getByType(type: ChannelType): IChannel[] {
    return [...this.channels.values()].filter((c) => c.type === type);
  }

  list(): IChannel[] {
    return [...this.channels.values()];
  }
}
