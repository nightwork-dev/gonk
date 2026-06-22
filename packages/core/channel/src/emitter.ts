// A tiny topic-keyed event emitter — replaces node:events so @gonk/channel/base
// stays free of Node built-ins (package-architecture rule). Subscribe returns an
// unsubscribe; emit fans out over a snapshot so a handler may unsubscribe mid-emit.

export type Listener<T = unknown> = (payload: T) => void;

export class Emitter {
  private topics = new Map<string, Set<Listener>>();

  on<T = unknown>(topic: string, listener: Listener<T>): () => void {
    let set = this.topics.get(topic);
    if (!set) {
      set = new Set();
      this.topics.set(topic, set);
    }
    set.add(listener as Listener);
    return () => {
      const s = this.topics.get(topic);
      if (s) {
        s.delete(listener as Listener);
        if (s.size === 0) this.topics.delete(topic);
      }
    };
  }

  emit<T = unknown>(topic: string, payload: T): void {
    const set = this.topics.get(topic);
    if (!set) return;
    for (const listener of [...set]) listener(payload);
  }
}
