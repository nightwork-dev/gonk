import type { ToolDefinition } from "./types.ts";

// =============================================================================
// Typed client facade — zero-codegen RPC projection of a tool registry.
//
// Define an operation once as a `ToolDefinition<I, O>`; project it to a typed
// client whose methods infer their input/output straight off the tool's
// generics. No codegen, no hand-maintained manifest.
//
// The inference holds ONLY while the tools are carried as a statically-typed
// `const` tuple (via `defineTools` / `mergeToolSets`). The moment they pass
// through a type-erased `ToolDefinition[]` or `ToolRegistry.list()`, the literal
// names and I/O generics widen to `string`/`unknown` and the client collapses to
// an `any`-typed index signature — so build the client from the tuple, never
// from the registry's runtime list. (This is a static-typing caveat; the runtime
// guards below still fire on the values even when the static type has widened.)
//
// Op names are globally unique wire identities (MCP tool name, CLI subcommand,
// the string the agent calls). `ToolRegistry.register` already throws on a
// duplicate; this facade enforces the SAME contract at construction so the two
// paths cannot disagree — plus a client-key-collision guard and a name-shape
// guard that together keep the type-level and runtime key derivations provably
// in step.
// =============================================================================

export type NamedToolDefinition<I = unknown, O = unknown, Name extends string = string> =
  ToolDefinition<I, O> & { name: Name };

type AnyNamedTool = NamedToolDefinition<any, any, string>;

type ToolInput<T> = T extends ToolDefinition<infer I, any> ? I : never;
type ToolOutput<T> = T extends ToolDefinition<any, infer O> ? O : never;

/** Type-level camelCase of a dotted op name. Provably equal to the runtime
 *  `dotToCamel` BECAUSE `assertValidNames` rejects any name whose every dot is
 *  not followed by `[a-z]` (see `NAME_PATTERN`) — so `Capitalize<Tail>` and the
 *  runtime `/\.([a-z])/` transform can never diverge (closes GLM Finding 4). */
type DotToCamel<S extends string> = S extends `${infer Head}.${infer Tail}`
  ? `${Head}${Capitalize<DotToCamel<Tail>>}`
  : S;

export type ClientTransport = {
  invoke(op: string, input?: unknown): Promise<unknown>;
};

export type ClientFor<Tools extends readonly AnyNamedTool[]> = {
  [T in Tools[number] as DotToCamel<T["name"]>]: (input: ToolInput<T>) => Promise<ToolOutput<T>>;
};

/** Dotted segments, each starting `[a-z]` and otherwise camelCase (`[A-Za-z0-9]`),
 *  e.g. `piece.get`, `audioBuild.propose`, `profile.binding.list`. Matches how
 *  real consumers name ops (tapestry uses camelCase-dotted, not kebab — despite
 *  the aspirational "kebab-case" note on `ToolDefinition.name`). Enforcing it is
 *  what lets `DotToCamel` (type) and `dotToCamel` (runtime) stay provably
 *  identical: every dot is followed by a lowercase letter, so `Capitalize<Tail>`
 *  and the runtime `/\.([a-z])/` transform cannot diverge — this rules out the
 *  empty-segment (`a..b`), dot-then-uppercase (`a.B`), dot-then-symbol (`a._x`),
 *  and dot-then-digit (`a.1b`) classes GLM flagged. Hyphenated/kebab op names
 *  aren't supported by the client projection yet (they'd leave a non-identifier
 *  `-` in the key); add multi-separator handling when a real consumer needs it. */
const NAME_PATTERN = /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*$/;

function dotToCamel(name: string): string {
  return name.replace(/\.([a-z])/g, (_match, char: string) => char.toUpperCase());
}

// ─── construction-time guards (each fails fast; mirror the registry) ─────────

function assertValidNames(tools: readonly AnyNamedTool[]): void {
  for (const tool of tools) {
    if (!NAME_PATTERN.test(tool.name)) {
      throw new Error(
        `Invalid op name for typed client: "${tool.name}" — expected camelCase dotted segments, each starting lowercase (e.g. "piece.get", "audioBuild.propose")`,
      );
    }
  }
}

function assertUniqueNames(tools: readonly AnyNamedTool[]): void {
  const seen = new Set<string>();
  for (const tool of tools) {
    if (seen.has(tool.name)) {
      throw new Error(`Duplicate op name in tool set: "${tool.name}" — op names are globally unique`);
    }
    seen.add(tool.name);
  }
}

function assertNoKeyCollision(tools: readonly AnyNamedTool[]): void {
  const keyToName = new Map<string, string>();
  for (const tool of tools) {
    const key = dotToCamel(tool.name);
    const prior = keyToName.get(key);
    if (prior !== undefined && prior !== tool.name) {
      throw new Error(
        `Client key collision: "${prior}" and "${tool.name}" both map to client method "${key}"`,
      );
    }
    keyToName.set(key, tool.name);
  }
}

/** Validate a tool set the way registration does, plus the client-key checks.
 *  Exported so a host can fail fast at assembly, not only at client build. */
export function assertRegisterableToolSet(tools: readonly AnyNamedTool[]): void {
  assertValidNames(tools);
  assertUniqueNames(tools);
  assertNoKeyCollision(tools);
}

// ─── assembly ────────────────────────────────────────────────────────────────

/** Carry a tool set as a statically-typed `const` tuple (preserves the per-tool
 *  `ToolDefinition<I, O>` generics the client infers from). */
export function defineTools<const Tools extends readonly AnyNamedTool[]>(tools: Tools): Tools {
  return tools;
}

/** Concatenate two tool sets preserving generics, fully validating the result
 *  (invalid name, duplicate name, AND client-key collision) so assembly fails
 *  fast — same contract `createClient` enforces, so a merged set that builds is
 *  always one `createClient` accepts. */
export function mergeToolSets<
  const A extends readonly AnyNamedTool[],
  const B extends readonly AnyNamedTool[],
>(a: A, b: B): readonly [...A, ...B] {
  const merged = [...a, ...b] as readonly [...A, ...B];
  assertRegisterableToolSet(merged);
  return merged;
}

/** Build a typed client over an injected transport. Throws at construction on an
 *  invalid name, a duplicate name, or a client-key collision — so a colliding
 *  set can never produce a live-but-wrong client. */
export function createClient<const Tools extends readonly AnyNamedTool[]>(
  tools: Tools,
  transport: ClientTransport,
): ClientFor<Tools> {
  assertRegisterableToolSet(tools);
  const client: Record<string, (input: unknown) => Promise<unknown>> = {};
  for (const tool of tools) {
    client[dotToCamel(tool.name)] = (input: unknown) => transport.invoke(tool.name, input);
  }
  return client as ClientFor<Tools>;
}
