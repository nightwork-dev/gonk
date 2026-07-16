import type { ContextContributor } from "./types.ts";

export class ContextContributorRegistry {
  private readonly contributors = new Map<string, ContextContributor>();

  register(contributor: ContextContributor): void {
    requireContributorId(contributor.id);
    if (this.contributors.has(contributor.id)) {
      throw new Error(`Context contributor already registered: ${contributor.id}`);
    }
    this.contributors.set(contributor.id, contributor);
  }

  get(id: string): ContextContributor | undefined {
    return this.contributors.get(id);
  }

  list(): readonly ContextContributor[] {
    return [...this.contributors.values()].sort((a, b) =>
      a.id.localeCompare(b.id)
    );
  }

  unregister(id: string): boolean {
    return this.contributors.delete(id);
  }
}

function requireContributorId(id: string): void {
  if (typeof id !== "string" || id.trim().length === 0) {
    throw new TypeError("Context contributor id must be a non-empty string");
  }
}
