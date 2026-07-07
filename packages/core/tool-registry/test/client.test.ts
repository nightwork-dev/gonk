import { describe, expect, it } from "vitest";
import {
  createClient,
  defineTools,
  mergeToolSets,
  type ClientTransport,
  type NamedToolDefinition,
} from "../src/client.ts";

// Minimal fake tool — only `.name` is read by the guards; the I/O generics carry
// the types the client infers. The `as` cast lives here, not at the probe sites.
function mkTool<I, O, N extends string>(name: N): NamedToolDefinition<I, O, N> {
  return { name } as unknown as NamedToolDefinition<I, O, N>;
}

interface InA { a: string }
interface InB { b: number }

const echoTransport: ClientTransport = { invoke: async (_op, input) => input };

describe("typed client facade", () => {
  it("infers per-op input/output for a non-colliding merged set; wrong types are compile errors", async () => {
    const content = defineTools([mkTool<InA, InA, "piece.get">("piece.get")] as const);
    const collab = defineTools([mkTool<InB, InB, "tag.apply">("tag.apply")] as const);
    const client = createClient(mergeToolSets(content, collab), echoTransport);

    const r: Promise<InA> = client.pieceGet({ a: "x" });
    await expect(r).resolves.toEqual({ a: "x" });

    // Type safety intact — these MUST NOT compile (unused directive => tsc fails):
    // @ts-expect-error pieceGet requires { a: string }
    client.pieceGet({ a: 1 });
    // @ts-expect-error tagApply (second set) requires { b: number }
    client.tagApply({ b: "no" });
  });

  // ── guard regression tests: each throws; REMOVE the guard and the test goes red ──

  it("throws on a duplicate dotted name (mirrors ToolRegistry.register)", () => {
    const a = defineTools([mkTool<InA, InA, "dup.x">("dup.x")] as const);
    const b = defineTools([mkTool<InB, InB, "dup.x">("dup.x")] as const);
    // fails fast at merge...
    expect(() => mergeToolSets(a, b)).toThrow(/Duplicate op name/);
    // ...and at client build if a caller assembles the array another way.
    const raw = [...a, ...b] as const;
    expect(() => createClient(raw, echoTransport)).toThrow(/Duplicate op name/);
  });

  it("throws on distinct names that collide to the same client key (GLM Finding 2)", () => {
    const s1 = defineTools([mkTool<InA, InA, "piece.get">("piece.get")] as const);
    const s2 = defineTools([mkTool<InB, InB, "pieceGet">("pieceGet")] as const);
    // NOTE: distinct dotted names — the registry would accept both; only the
    // client-key derivation collides. Caught at BOTH assembly and client build.
    expect(() => mergeToolSets(s1, s2)).toThrow(/Client key collision/);
    const raw = [...s1, ...s2] as const;
    expect(() => createClient(raw, echoTransport)).toThrow(/Client key collision/);
  });

  it("throws on a name that violates the camelCase-dotted convention (closes the F4 divergence class)", () => {
    // dot-then-uppercase, empty segment, dot-then-symbol, leading uppercase,
    // dot-then-digit, and hyphen (unsupported) — every runtime/type divergence class.
    for (const bad of ["a.B", "a..b", "a._x", "Piece.Get", "piece.1x", "audio-build.propose"]) {
      const set = [mkTool<InA, InA, string>(bad)] as const;
      expect(() => createClient(set, echoTransport), bad).toThrow(/Invalid op name/);
    }
  });

  it("accepts valid camelCase-dotted names incl. multi-segment", () => {
    const set = defineTools([
      mkTool<InA, InA, "audioBuild.propose">("audioBuild.propose"),
      mkTool<InB, InB, "profile.binding.list">("profile.binding.list"),
    ] as const);
    const client = createClient(set, echoTransport);
    expect(typeof (client as Record<string, unknown>).audioBuildPropose).toBe("function");
    expect(typeof (client as Record<string, unknown>).profileBindingList).toBe("function");
  });
});
