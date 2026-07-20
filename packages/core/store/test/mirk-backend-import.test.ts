import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function importMirkBackendForCase(id: string) {
  return import(/* @vite-ignore */ `../src/mirk-backend.ts?${id}`);
}

describe("@gonk/store/sqlite import failure handling", () => {
  it("exposes the SQLite backend subpath shape when the optional peer is present", async () => {
    const module = await import("../src/mirk-backend.ts");

    expect(module.MirkStoreBackend).toEqual(expect.any(Function));
    expect(module.mirkBackendFactory).toEqual(expect.any(Function));
    expect(module.mirkStoreDbPath).toEqual(expect.any(Function));
  });

  it("wraps only missing better-sqlite3 optional-peer failures with setup guidance", async () => {
    await vi.resetModules();
    const cause = Object.assign(
      new Error("Cannot find package 'better-sqlite3' imported from @mirk/store/sqlite"),
      { code: "ERR_MODULE_NOT_FOUND" },
    );
    vi.doMock("@mirk/store/sqlite", () => ({
      get SqliteAdapter() {
        throw cause;
      },
    }));

    await expect(importMirkBackendForCase("missing-better-sqlite3")).rejects.toMatchObject({
      message:
        "@gonk/store/sqlite requires the optional native peer better-sqlite3. Install better-sqlite3 in the host package to use the Mirk SQLite backend.",
      cause,
    });

    vi.doUnmock("@mirk/store/sqlite");
    await vi.resetModules();
  });

  it("rethrows unrelated import-time failures without masking them as optional-peer setup", async () => {
    await vi.resetModules();
    const cause = Object.assign(new Error("adapter initialization exploded"), {
      code: "ERR_MODULE_NOT_FOUND",
    });
    vi.doMock("@mirk/store/sqlite", () => ({
      get SqliteAdapter() {
        throw cause;
      },
    }));

    await expect(importMirkBackendForCase("unrelated-import-failure")).rejects.toBe(cause);

    vi.doUnmock("@mirk/store/sqlite");
    await vi.resetModules();
  });

  it("does not treat a prefixed package name as the missing optional peer", async () => {
    await vi.resetModules();
    const cause = Object.assign(
      new Error("Cannot find package 'better-sqlite3-helper' imported from @mirk/store/sqlite"),
      { code: "ERR_MODULE_NOT_FOUND" },
    );
    vi.doMock("@mirk/store/sqlite", () => ({
      get SqliteAdapter() {
        throw cause;
      },
    }));

    await expect(importMirkBackendForCase("missing-better-sqlite3-helper")).rejects.toBe(cause);

    vi.doUnmock("@mirk/store/sqlite");
    await vi.resetModules();
  });

  it("does not mask an unexpected @mirk/store/sqlite export shape", async () => {
    await vi.resetModules();
    vi.doMock("@mirk/store/sqlite", () => ({ SqliteAdapter: undefined }));

    await expect(importMirkBackendForCase("missing-sqlite-adapter-export")).rejects.toThrow(
      "@mirk/store/sqlite did not export SqliteAdapter",
    );

    vi.doUnmock("@mirk/store/sqlite");
    await vi.resetModules();
  });

  it("does not mask adapter initialization failures after import succeeds", async () => {
    await vi.resetModules();
    const cause = new Error("native binding ABI mismatch");
    vi.doMock("@mirk/store/sqlite", () => ({
      SqliteAdapter: class {
        constructor() {
          throw cause;
        }
      },
    }));
    const dir = mkdtempSync(join(tmpdir(), "gonk-store-init-failure-"));

    try {
      const module = await importMirkBackendForCase("adapter-init-failure");
      expect(() => new module.MirkStoreBackend(dir)).toThrow(cause);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      vi.doUnmock("@mirk/store/sqlite");
      await vi.resetModules();
    }
  });
});
