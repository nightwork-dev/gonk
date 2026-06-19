import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BackedVectorStore, FsStoreBackend } from "../src/index.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gonk-store-vec-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function vector() {
  return new BackedVectorStore(new FsStoreBackend(dir));
}

// Independent brute-force cosine baseline computed in the test (NOT imported
// from src) — this is the parity reference the store's ranking must equal.
function bruteForceCosine(a: number[], b: number[]): number {
  let dot = 0;
  let an = 0;
  let bn = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    an += (a[i] ?? 0) ** 2;
    bn += (b[i] ?? 0) ** 2;
  }
  if (an === 0 || bn === 0) return 0;
  return dot / (Math.sqrt(an) * Math.sqrt(bn));
}

// A fixed corpus of 8 four-dim vectors.
const corpus: Array<{ id: string; vector: number[] }> = [
  { id: "a", vector: [1, 0, 0, 0] },
  { id: "b", vector: [0.9, 0.1, 0, 0] },
  { id: "c", vector: [0, 1, 0, 0] },
  { id: "d", vector: [0.5, 0.5, 0.5, 0.5] },
  { id: "e", vector: [-1, 0, 0, 0] },
  { id: "f", vector: [0.2, 0.8, 0.1, 0] },
  { id: "g", vector: [0, 0, 1, 0] },
  { id: "h", vector: [0.7, 0.7, 0, 0] },
];

describe("VectorStore — KNN parity with brute-force JS cosine", () => {
  it("top-k ranking equals the brute-force baseline", () => {
    const store = vector();
    for (const e of corpus) store.upsert(e.id, e.vector, { tag: e.id });

    const query = [0.8, 0.2, 0, 0];
    const k = 4;

    // Baseline: score every corpus vector with the independent cosine, sort
    // desc by score then id (the same deterministic tie-break the store uses).
    const baseline = corpus
      .map((e) => ({ id: e.id, score: bruteForceCosine(query, e.vector) }))
      .sort((x, y) => y.score - x.score || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
      .slice(0, k);

    const got = store.search(query, k);

    expect(got.map((m) => m.id)).toEqual(baseline.map((b) => b.id));
    for (let i = 0; i < got.length; i++) {
      expect(got[i]!.score).toBeCloseTo(baseline[i]!.score, 12);
    }
  });

  it("honors a metadata filter and returns meta", () => {
    const store = vector();
    store.upsert("keep1", [1, 0, 0, 0], { keep: true });
    store.upsert("drop", [0.99, 0.01, 0, 0], { keep: false });
    store.upsert("keep2", [0.9, 0.1, 0, 0], { keep: true });

    const got = store.search([1, 0, 0, 0], 5, (meta) => meta.keep === true);
    expect(got.map((m) => m.id)).toEqual(["keep1", "keep2"]);
    expect(got[0]!.meta).toEqual({ keep: true });
  });

  it("upsert overwrites, delete removes, and persists across reopen", () => {
    const a = vector();
    a.upsert("x", [1, 0, 0, 0], { v: 1 });
    a.upsert("x", [0, 1, 0, 0], { v: 2 }); // overwrite
    a.upsert("y", [0, 0, 1, 0]);
    a.delete("y");

    const b = new BackedVectorStore(new FsStoreBackend(dir));
    const all = b.search([0, 1, 0, 0], 10);
    expect(all.map((m) => m.id)).toEqual(["x"]);
    expect(all[0]!.meta).toEqual({ v: 2 });
  });
});
