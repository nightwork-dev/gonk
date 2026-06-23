import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { parse, stringify } from "yaml";

import { atomicWriteText } from "@gonk/utils/fs";
import { safeKeyPath } from "@gonk/utils/path";

import type { BlobHandle, RootAdapter, RootKind, ScopeName } from "./types.ts";

const SETTINGS_DIR = "settings";
const BLOBS_DIR = "blobs";

/** Standard root adapter — the unified `.agents/`-style layout, usable
 *  for any root directory (.agents/, .gonk/, .claude/, .pi/, …).
 *
 *  Layout:
 *    <root>/
 *      agents/<id>.md           — persona definitions (read by PersonaRegistry, not here)
 *      settings/<ext>.yaml      — per-extension K/V; first dotted segment of the
 *                                 scope key determines the file, the rest of the
 *                                 key is stored hierarchically inside the file.
 *      skills/<id>/SKILL.md     — skills (read by SkillRegistry, not here)
 *      blobs/<key>              — binary blobs
 *      blobs/<key>.mime         — optional sidecar holding the blob's mime type
 *
 *  Co-habitates with whatever the tool that owns the root puts there. We
 *  only read/write the four subdirs above; everything else is left alone. */
export class StandardRootAdapter implements RootAdapter {
  constructor(public readonly kind: RootKind, public readonly path: string) {}

  // ---- Settings ------------------------------------------------------------

  readSetting(key: string): unknown | undefined {
    const ext = extName(key);
    if (!ext) return undefined;
    const inner = key.slice(ext.length + 1);
    const cfg = this.readExtYaml(ext);
    return getPath(cfg, inner);
  }

  writeSetting(key: string, value: unknown): void {
    const ext = extName(key);
    if (!ext) {
      throw new Error(
        `StandardRootAdapter: keys must have an extension namespace (a dot separating the first segment); got '${key}'`,
      );
    }
    const inner = key.slice(ext.length + 1);
    const cfg = this.readExtYaml(ext);
    setPath(cfg, inner, value);
    this.writeExtYaml(ext, cfg);
  }

  deleteSetting(key: string): void {
    const ext = extName(key);
    if (!ext) return;
    const inner = key.slice(ext.length + 1);
    const cfg = this.readExtYaml(ext);
    if (deletePath(cfg, inner)) {
      this.writeExtYaml(ext, cfg);
    }
  }

  listSettings(prefix: string): string[] {
    const out: string[] = [];
    const settingsDir = join(this.path, SETTINGS_DIR);
    if (!existsSync(settingsDir)) return out;

    let entries: string[];
    try {
      entries = readdirSync(settingsDir);
    } catch {
      return out;
    }

    const prefixExt = extName(prefix);

    for (const file of entries) {
      if (!file.endsWith(".yaml") && !file.endsWith(".yml")) continue;
      const ext = basename(file, file.endsWith(".yml") ? ".yml" : ".yaml");

      // If the prefix targets a specific extension, only scan that file.
      if (prefixExt && ext !== prefixExt) continue;
      // If the prefix has no dot yet (e.g., "voi"), it might be filtering by
      // ext name — only scan files whose ext starts with the prefix.
      if (!prefixExt && prefix && !ext.startsWith(prefix)) continue;

      const cfg = this.readExtYaml(ext);
      for (const innerKey of flatKeys(cfg)) {
        const fullKey = `${ext}.${innerKey}`;
        if (fullKey.startsWith(prefix)) out.push(fullKey);
      }
    }
    return out;
  }

  // ---- Blobs ---------------------------------------------------------------

  blobHandle(key: string, scope: ScopeName): BlobHandle | undefined {
    const path = this.blobPath(key);
    if (!existsSync(path)) return undefined;
    const stat = statSync(path);
    const mime = this.readMimeSidecar(key);
    return {
      scope,
      rootKind: this.kind,
      root: this.path,
      key,
      path,
      size: stat.size,
      ...(mime !== undefined ? { mimeType: mime } : {}),
    };
  }

  async readBlob(key: string): Promise<Uint8Array | undefined> {
    const path = this.blobPath(key);
    if (!existsSync(path)) return undefined;
    return new Uint8Array(await readFile(path));
  }

  async writeBlob(
    key: string,
    data: Uint8Array,
    opts?: { mimeType?: string },
  ): Promise<BlobHandle> {
    const path = this.blobPath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
    if (opts?.mimeType) {
      await writeFile(`${path}.mime`, opts.mimeType);
    }
    return {
      scope: "global", // placeholder; ScopeStore rewrites with the real tier
      rootKind: this.kind,
      root: this.path,
      key,
      path,
      size: data.byteLength,
      ...(opts?.mimeType ? { mimeType: opts.mimeType } : {}),
    };
  }

  async deleteBlob(key: string): Promise<void> {
    const path = this.blobPath(key);
    await rm(path, { force: true });
    await rm(`${path}.mime`, { force: true });
  }

  // ---- Internals -----------------------------------------------------------

  private readExtYaml(ext: string): Record<string, unknown> {
    const yaml = join(this.path, SETTINGS_DIR, `${ext}.yaml`);
    const yml = join(this.path, SETTINGS_DIR, `${ext}.yml`);
    const path = existsSync(yaml) ? yaml : existsSync(yml) ? yml : undefined;
    if (!path) return {};
    try {
      const text = readFileSync(path, "utf8");
      const parsed = parse(text);
      return parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  private writeExtYaml(ext: string, cfg: Record<string, unknown>): void {
    const path = join(this.path, SETTINGS_DIR, `${ext}.yaml`);
    atomicWriteText(path, stringify(cfg));
  }

  private readMimeSidecar(key: string): string | undefined {
    const path = `${this.blobPath(key)}.mime`;
    if (!existsSync(path)) return undefined;
    try {
      return readFileSync(path, "utf8").trim();
    } catch {
      return undefined;
    }
  }

  private blobPath(key: string): string {
    return safeKeyPath(this.path, BLOBS_DIR, key);
  }
}

// ---------------------------------------------------------------------------
// Helpers — hierarchical key handling inside a settings YAML.
//
// Keys are dotted (e.g., "tts.providers.openai.baseURL"). We store them as
// nested objects in the YAML so the file is readable and editable by hand,
// while preserving the flat-dotted API that existing callers depend on.
// ---------------------------------------------------------------------------

/** First dotted segment of a key. Returns undefined if there's no dot. */
function extName(key: string): string | undefined {
  const idx = key.indexOf(".");
  return idx < 0 ? undefined : key.slice(0, idx);
}

function getPath(obj: Record<string, unknown>, path: string): unknown {
  const segs = path.split(".");
  let cur: unknown = obj;
  for (const s of segs) {
    if (cur === undefined || cur === null || typeof cur !== "object") {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[s];
  }
  return cur;
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const segs = path.split(".");
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < segs.length - 1; i++) {
    const s = segs[i]!;
    const next = cur[s];
    if (next === undefined || next === null || typeof next !== "object" || Array.isArray(next)) {
      cur[s] = {};
    }
    cur = cur[s] as Record<string, unknown>;
  }
  cur[segs[segs.length - 1]!] = value;
}

function deletePath(obj: Record<string, unknown>, path: string): boolean {
  const segs = path.split(".");
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < segs.length - 1; i++) {
    const s = segs[i]!;
    const next = cur[s];
    if (!next || typeof next !== "object") return false;
    cur = next as Record<string, unknown>;
  }
  const last = segs[segs.length - 1]!;
  if (last in cur) {
    delete cur[last];
    return true;
  }
  return false;
}

/** Flatten a nested object into dotted leaf keys. Stops at primitives,
 *  arrays, and at non-plain-object values. */
function flatKeys(obj: unknown, prefix = ""): string[] {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const next = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const children = flatKeys(v, next);
      // If an object has no leaf children (empty), still emit the key
      if (children.length === 0) out.push(next);
      else out.push(...children);
    } else {
      out.push(next);
    }
  }
  return out;
}
