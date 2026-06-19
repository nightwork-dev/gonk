import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BackedBlobStore, FsStoreBackend } from "../src/index.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gonk-store-blob-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function blob() {
  return new BackedBlobStore(new FsStoreBackend(dir));
}

describe("BlobStore", () => {
  it("put/get/delete/list round-trip", () => {
    const store = blob();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    expect(store.get("a")).toBeUndefined();
    store.put("a", bytes);
    expect(store.get("a")).toEqual(bytes);
    store.put("nested/b", new Uint8Array([9]), { mimeType: "application/octet-stream" });
    expect(store.list()).toEqual(["a", "nested/b"]);
    expect(store.list("nested/")).toEqual(["nested/b"]);
    store.delete("a");
    expect(store.get("a")).toBeUndefined();
    expect(store.list()).toEqual(["nested/b"]);
  });

  it("persists across a fresh store reopened from the same dir", () => {
    const a = blob();
    a.put("portrait", new Uint8Array([7, 7, 7]));
    const b = new BackedBlobStore(new FsStoreBackend(dir));
    expect(b.get("portrait")).toEqual(new Uint8Array([7, 7, 7]));
  });
});
