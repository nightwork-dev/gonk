import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  type Dirent,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ScopeName } from "@gonk/scope";
import type { SyncStore } from "@mirk/store";
import type { VectorDocument, VectorStore } from "@mirk/store/vector";

import type { GonkSyncState } from "./state.ts";

const LEGACY_KV_FILE = "kv.json";
const LEGACY_BLOBS_DIR = "blobs";
const LEGACY_LOG_FILE = "log.jsonl";
const LEGACY_VECTORS_FILE = "vectors.jsonl";

export const LEGACY_BLOBS_COLLECTION = "blobs";
export const LEGACY_LOG_COLLECTION = "log";
export const LEGACY_META_COLLECTION = "meta";
export const LEGACY_TTL_COLLECTION = "legacy-kv-ttl";
export const LEGACY_VECTOR_COLLECTION = "vectors";
export const LEGACY_IMPORT_RECEIPT_PREFIX = "legacy-fs-import-v1";
export const LEGACY_NEXT_LOG_OFFSET_ID = "nextLogOffset";

export type LegacyImportMode = "dry-run" | "write";
export type LegacyImportFamily = "kv" | "blob" | "log" | "vector";

export interface LegacyImportStateDestination {
  kind: "gonk-state";
  state: GonkSyncState;
  tier: ScopeName;
  namespace: string;
  /** Stable operator-chosen label. Restricted to a safe identifier alphabet. */
  identity: string;
  /** Host-owned serialization/transaction boundary for write mode. */
  runExclusive?<T>(work: () => T): T;
}

export interface LegacyImportMirkDestination {
  kind: "mirk-ports";
  /** Already-selected Mirk KV/collection port. */
  kv: SyncStore;
  /** Required only when the source contains valid vectors. */
  vector?: VectorStore;
  /** Receipt label only; the supplied ports remain caller-owned. */
  tier?: ScopeName;
  /** Receipt label only; the supplied ports remain caller-owned. */
  namespace: string;
  /** Stable operator-chosen label. Restricted to a safe identifier alphabet. */
  identity: string;
  /** Host-owned serialization/transaction boundary for write mode. */
  runExclusive?<T>(work: () => T): T;
}

export type LegacyImportDestination =
  | LegacyImportStateDestination
  | LegacyImportMirkDestination;

export interface LegacyImportPackageVersions {
  /** Version that wrote the legacy files. Raw files cannot prove this. */
  source: string;
  importer?: string;
  destination?: string;
}

export interface ImportLegacyFsStoreOptions {
  /** Explicit legacy FsStoreBackend namespace directory. */
  sourceDir: string;
  destination: LegacyImportDestination;
  mode: LegacyImportMode;
  /** Test/host clock. Called for receipt start and completion. */
  now?: () => Date;
  /** Overrides for packed or embedded hosts where package discovery is unavailable. */
  packageVersions: LegacyImportPackageVersions;
}

export interface LegacySourceManifestEntry {
  path: string;
  size: number;
  sha256: string;
}

export interface LegacyImportIssue {
  family: LegacyImportFamily;
  source: string;
  reason: string;
  contentSha256?: string;
}

export interface LegacyImportFamilyCounts {
  discovered: number;
  eligible: number;
  written: number;
  identical: number;
  skipped: number;
  invalid: number;
}

export interface LegacyImportReceipt {
  schemaVersion: 1;
  status: "dry-run" | "applied" | "already-imported";
  mode: LegacyImportMode;
  startedAt: string;
  completedAt: string;
  source: {
    pathSha256: string;
    manifestSha256: string;
    manifest: LegacySourceManifestEntry[];
  };
  destination: {
    identity: string;
    tier?: ScopeName;
    namespace: string;
    kvBackend: string;
    vectorBackend?: string;
  };
  packages: {
    source: { name: "@gonk/store"; version: string };
    importer: { name: "@gonk/store"; version: string };
    destination: { name: "@mirk/store"; version: string };
  };
  counts: Record<LegacyImportFamily, LegacyImportFamilyCounts>;
  skipped: LegacyImportIssue[];
  invalid: LegacyImportIssue[];
  contentSha256: Record<LegacyImportFamily, string>;
  markerId: string;
  priorReceiptSha256?: string;
  receiptSha256: string;
}

export interface LegacyImportConflict {
  family: LegacyImportFamily | "receipt";
  key: string;
  reason: string;
}

export class LegacyImportConflictError extends Error {
  readonly conflicts: readonly LegacyImportConflict[];

  constructor(conflicts: readonly LegacyImportConflict[]) {
    super(
      `Legacy store import refused ${conflicts.length} ambiguous destination conflict${
        conflicts.length === 1 ? "" : "s"
      }`,
    );
    this.name = "LegacyImportConflictError";
    this.conflicts = conflicts;
  }
}

interface LegacyKvCandidate {
  key: string;
  value: unknown;
  expiresAt?: number;
  digest: string;
}

interface LegacyBlobCandidate {
  key: string;
  bytesBase64: string;
  mimeType?: string;
  digest: string;
}

interface LegacyLogCandidate {
  id: string;
  offset: number;
  record: unknown;
  digest: string;
}

interface LegacyVectorCandidate {
  id: string;
  vector: number[];
  metadata: Record<string, unknown>;
  digest: string;
}

interface ParsedLegacySource {
  manifest: LegacySourceManifestEntry[];
  manifestDigest: string;
  pathDigest: string;
  kv: LegacyKvCandidate[];
  blobs: LegacyBlobCandidate[];
  logs: LegacyLogCandidate[];
  vectors: LegacyVectorCandidate[];
  logFileSize?: number;
  discovered: Record<LegacyImportFamily, number>;
  skipped: LegacyImportIssue[];
  invalid: LegacyImportIssue[];
}

interface ResolvedDestination {
  kv: SyncStore;
  vector(): VectorStore | undefined;
  identity: string;
  tier?: ScopeName;
  namespace: string;
  runExclusive?<T>(work: () => T): T;
}

interface PendingWrites {
  kv: LegacyKvCandidate[];
  blobs: LegacyBlobCandidate[];
  logs: LegacyLogCandidate[];
  vectors: LegacyVectorCandidate[];
  logMeta?: { id: string; value: number };
}

interface StoredReceiptRecord {
  id: string;
  receipt: LegacyImportReceipt;
}

/** Inspect and import one explicit legacy FsStoreBackend namespace.
 *
 * This function never deletes or rewrites source files and never chooses an
 * adapter. It parses the complete source, preflights every destination record,
 * refuses conflicts before writing, and writes the receipt marker last.
 */
export function importLegacyFsStore(options: ImportLegacyFsStoreOptions): LegacyImportReceipt {
  if (options.mode !== "dry-run" && options.mode !== "write") {
    throw new Error(`Legacy import mode must be 'dry-run' or 'write'; got ${String(options.mode)}`);
  }
  const clock = options.now ?? (() => new Date());
  const startedAt = validTimestamp(clock(), "start");
  const startedMs = Date.parse(startedAt);
  const source = parseLegacySource(options.sourceDir, startedMs);
  const destination = resolveDestination(options.destination);
  const packageVersions = resolvePackageVersions(options.packageVersions);
  if (options.mode === "write" && !destination.runExclusive) {
    throw new Error(
      "Legacy import write mode requires destination.runExclusive so preflight, writes, and receipt are one host-owned transaction or serialized critical section",
    );
  }

  const execute = (): LegacyImportReceipt => {
  const markerId = `${LEGACY_IMPORT_RECEIPT_PREFIX}:${source.manifestDigest}`;
  const counts = initialCounts(source);
  const conflicts: LegacyImportConflict[] = [];
  const pending: PendingWrites = {
    kv: [],
    blobs: [],
    logs: [],
    vectors: [],
  };

  preflightKv(source.kv, destination.kv, pending, counts.kv, conflicts);
  preflightBlobs(source.blobs, destination.kv, pending, counts.blob, conflicts);
  preflightLogs(source.logs, source.logFileSize, destination.kv, pending, counts.log, conflicts);

  let vector: VectorStore | undefined;
  if (source.vectors.length > 0) {
    vector = destination.vector();
    if (!vector) {
      throw new Error(
        "Legacy store source contains vectors but the destination provides no Mirk vector port",
      );
    }
    const dimensions = source.vectors[0]!.vector.length;
    if (vector.meta.dimensions !== dimensions) {
      throw new Error(
        `Legacy vector dimensions ${dimensions} do not match destination dimensions ${vector.meta.dimensions}`,
      );
    }
    preflightVectors(source.vectors, vector, pending, counts.vector, conflicts);
  }

  const storedMarker = getByIdOrNull<StoredReceiptRecord>(
    destination.kv,
    LEGACY_META_COLLECTION,
    markerId,
  );
  if (
    storedMarker &&
    !isStoredReceipt(
      storedMarker,
      markerId,
      source.manifestDigest,
      destination,
      packageVersions,
    )
  ) {
    conflicts.push({
      family: "receipt",
      key: markerId,
      reason: "existing receipt marker does not describe this source and destination",
    });
  }
  if (storedMarker && totalPending(pending) > 0) {
    conflicts.push({
      family: "receipt",
      key: markerId,
      reason: "receipt marker exists but one or more imported destination records are missing",
    });
  }
  if (conflicts.length > 0) throw new LegacyImportConflictError(conflicts);
  assertSourceUnchanged(options.sourceDir, source.manifestDigest);

  const receiptBase = (completedAt: string) => ({
    schemaVersion: 1 as const,
    mode: options.mode,
    startedAt,
    completedAt,
    source: {
      pathSha256: source.pathDigest,
      manifestSha256: source.manifestDigest,
      manifest: source.manifest,
    },
    destination: {
      identity: destination.identity,
      ...(destination.tier ? { tier: destination.tier } : {}),
      namespace: destination.namespace,
      kvBackend: destination.kv.meta.backend,
      ...(vector ? { vectorBackend: vector.meta.backend } : {}),
    },
    packages: packageVersions,
    counts,
    skipped: source.skipped,
    invalid: source.invalid,
    contentSha256: familyDigests(source),
    markerId,
  });

  if (options.mode === "dry-run") {
    return withReceiptDigest({
      ...receiptBase(validTimestamp(clock(), "completion")),
      status: "dry-run",
    });
  }

  if (storedMarker) {
    return withReceiptDigest({
      ...receiptBase(validTimestamp(clock(), "completion")),
      status: "already-imported",
      priorReceiptSha256: storedMarker.receipt.receiptSha256,
    });
  }

  writePending(destination.kv, vector, pending, counts);
  const receipt = withReceiptDigest({
    ...receiptBase(validTimestamp(clock(), "completion")),
    status: "applied",
  });
  destination.kv.put<StoredReceiptRecord>(LEGACY_META_COLLECTION, {
    id: markerId,
    receipt,
  });
  return receipt;
  };

  return options.mode === "write" ? destination.runExclusive!(execute) : execute();
}

/** Read-only source manifest helper for operator verification and tests. */
export function inspectLegacyFsSource(sourceDir: string): {
  pathSha256: string;
  manifestSha256: string;
  manifest: LegacySourceManifestEntry[];
} {
  const parsed = parseLegacySource(sourceDir, Date.now());
  return {
    pathSha256: parsed.pathDigest,
    manifestSha256: parsed.manifestDigest,
    manifest: parsed.manifest,
  };
}

function resolveDestination(destination: LegacyImportDestination): ResolvedDestination {
  assertSafeIdentity(destination.identity);
  assertNamespaceLabel(destination.namespace);
  if (destination.kind === "gonk-state") {
    return {
      kv: destination.state.kv(destination.tier, destination.namespace),
      vector: () => destination.state.vector(destination.tier, destination.namespace),
      identity: destination.identity,
      tier: destination.tier,
      namespace: destination.namespace,
      ...(destination.runExclusive ? { runExclusive: destination.runExclusive } : {}),
    };
  }
  if (destination.kind === "mirk-ports") {
    return {
      kv: destination.kv,
      vector: () => destination.vector,
      identity: destination.identity,
      ...(destination.tier ? { tier: destination.tier } : {}),
      namespace: destination.namespace,
      ...(destination.runExclusive ? { runExclusive: destination.runExclusive } : {}),
    };
  }
  throw new Error(
    `Legacy import destination kind must be 'gonk-state' or 'mirk-ports'; got ${String(
      (destination as { kind?: unknown }).kind,
    )}`,
  );
}

function parseLegacySource(sourceDir: string, nowMs: number): ParsedLegacySource {
  const absolute = resolve(sourceDir);
  if (!existsSync(absolute)) {
    throw new Error(`Legacy store source must be an existing directory: ${sourceDir}`);
  }
  assertSourceBoundary(absolute);

  const manifest = sourceManifest(absolute);
  const skipped: LegacyImportIssue[] = [];
  const invalid: LegacyImportIssue[] = [];
  const discovered: Record<LegacyImportFamily, number> = {
    kv: 0,
    blob: 0,
    log: 0,
    vector: 0,
  };

  const kv = parseKv(absolute, nowMs, discovered, skipped, invalid);
  const blobs = parseBlobs(absolute, discovered, invalid);
  const logResult = parseLogs(absolute, discovered, invalid);
  const vectors = parseVectors(absolute, discovered, skipped, invalid);

  return {
    manifest,
    manifestDigest: digestJson(manifest),
    pathDigest: sha256(absolute),
    kv,
    blobs,
    logs: logResult.records,
    vectors,
    ...(logResult.fileSize !== undefined ? { logFileSize: logResult.fileSize } : {}),
    discovered,
    skipped,
    invalid,
  };
}

function parseKv(
  sourceDir: string,
  nowMs: number,
  discovered: Record<LegacyImportFamily, number>,
  skipped: LegacyImportIssue[],
  invalid: LegacyImportIssue[],
): LegacyKvCandidate[] {
  const path = join(sourceDir, LEGACY_KV_FILE);
  if (!existsSync(path)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    invalid.push({ family: "kv", source: LEGACY_KV_FILE, reason: "file is not valid JSON" });
    return [];
  }
  if (!isPlainObject(parsed)) {
    invalid.push({ family: "kv", source: LEGACY_KV_FILE, reason: "root must be a JSON object" });
    return [];
  }

  const candidates: LegacyKvCandidate[] = [];
  for (const [key, raw] of Object.entries(parsed).sort(([a], [b]) => a.localeCompare(b))) {
    discovered.kv++;
    const contentSha256 = digestJson(raw);
    if (!isPlainObject(raw) || !Object.prototype.hasOwnProperty.call(raw, "value")) {
      invalid.push({
        family: "kv",
        source: `${LEGACY_KV_FILE}#${key}`,
        reason: "entry must be an object with a value field",
        contentSha256,
      });
      continue;
    }
    const expiresAt = raw.expiresAt;
    if (expiresAt !== undefined && (!Number.isFinite(expiresAt) || typeof expiresAt !== "number")) {
      invalid.push({
        family: "kv",
        source: `${LEGACY_KV_FILE}#${key}`,
        reason: "expiresAt must be a finite number",
        contentSha256,
      });
      continue;
    }
    if (typeof expiresAt === "number" && expiresAt <= nowMs) {
      skipped.push({
        family: "kv",
        source: `${LEGACY_KV_FILE}#${key}`,
        reason: "entry expired before import started",
        contentSha256,
      });
      continue;
    }
    candidates.push({
      key,
      value: raw.value,
      ...(typeof expiresAt === "number" ? { expiresAt } : {}),
      digest: digestJson({ key, value: raw.value, expiresAt }),
    });
  }
  return candidates;
}

function parseBlobs(
  sourceDir: string,
  discovered: Record<LegacyImportFamily, number>,
  invalid: LegacyImportIssue[],
): LegacyBlobCandidate[] {
  const base = join(sourceDir, LEGACY_BLOBS_DIR);
  if (!existsSync(base)) return [];
  const candidates: LegacyBlobCandidate[] = [];
  for (const relativePath of walkFiles(base)) {
    if (relativePath.endsWith(".mime")) {
      const dataPath = join(base, ...relativePath.slice(0, -".mime".length).split("/"));
      if (!existsSync(dataPath)) {
        discovered.blob++;
        invalid.push({
          family: "blob",
          source: `${LEGACY_BLOBS_DIR}/${relativePath}`,
          reason: "orphan MIME sidecar has no data file",
          contentSha256: sha256(readFileSync(join(base, ...relativePath.split("/")))),
        });
      }
      continue;
    }
    discovered.blob++;
    const absolute = join(base, ...relativePath.split("/"));
    const bytes = readFileSync(absolute);
    const mimePath = `${absolute}.mime`;
    const mimeType = existsSync(mimePath) ? readFileSync(mimePath, "utf8") : undefined;
    candidates.push({
      key: relativePath,
      bytesBase64: bytes.toString("base64"),
      ...(mimeType ? { mimeType } : {}),
      digest: sha256(bytes),
    });
  }
  return candidates;
}

function parseLogs(
  sourceDir: string,
  discovered: Record<LegacyImportFamily, number>,
  invalid: LegacyImportIssue[],
): { records: LegacyLogCandidate[]; fileSize?: number } {
  const path = join(sourceDir, LEGACY_LOG_FILE);
  if (!existsSync(path)) return { records: [] };
  const bytes = readFileSync(path);
  const records: LegacyLogCandidate[] = [];
  let offset = 0;
  for (let index = 0; index <= bytes.length; index++) {
    if (index < bytes.length && bytes[index] !== 0x0a) continue;
    const line = bytes.subarray(offset, index);
    if (line.length > 0) {
      discovered.log++;
      const digest = sha256(line);
      try {
        const record = JSON.parse(line.toString("utf8")) as unknown;
        records.push({ id: String(offset), offset, record, digest });
      } catch {
        invalid.push({
          family: "log",
          source: `${LEGACY_LOG_FILE}@${offset}`,
          reason: "line is not valid JSON",
          contentSha256: digest,
        });
      }
    }
    offset = index + 1;
  }
  return { records, fileSize: bytes.length };
}

function parseVectors(
  sourceDir: string,
  discovered: Record<LegacyImportFamily, number>,
  skipped: LegacyImportIssue[],
  invalid: LegacyImportIssue[],
): LegacyVectorCandidate[] {
  const path = join(sourceDir, LEGACY_VECTORS_FILE);
  if (!existsSync(path)) return [];
  const byId = new Map<string, LegacyVectorCandidate>();
  const sourceLineById = new Map<string, number>();
  const lines = readFileSync(path, "utf8").split("\n");
  let expectedDimensions: number | undefined;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (!line) continue;
    discovered.vector++;
    const contentSha256 = sha256(line);
    let raw: unknown;
    try {
      raw = JSON.parse(line) as unknown;
    } catch {
      invalid.push({
        family: "vector",
        source: `${LEGACY_VECTORS_FILE}:${index + 1}`,
        reason: "line is not valid JSON",
        contentSha256,
      });
      continue;
    }
    if (
      !isPlainObject(raw) ||
      typeof raw.id !== "string" ||
      raw.id.length === 0 ||
      !Array.isArray(raw.vector) ||
      raw.vector.length === 0 ||
      !raw.vector.every((value) => typeof value === "number" && Number.isFinite(value)) ||
      (raw.meta !== undefined && !isPlainObject(raw.meta))
    ) {
      invalid.push({
        family: "vector",
        source: `${LEGACY_VECTORS_FILE}:${index + 1}`,
        reason: "entry must contain id, a finite non-empty vector, and object metadata",
        contentSha256,
      });
      continue;
    }
    expectedDimensions ??= raw.vector.length;
    if (raw.vector.length !== expectedDimensions) {
      invalid.push({
        family: "vector",
        source: `${LEGACY_VECTORS_FILE}:${index + 1}`,
        reason: `vector dimensions ${raw.vector.length} differ from ${expectedDimensions}`,
        contentSha256,
      });
      continue;
    }
    const normalizedVector = Array.from(Float32Array.from(raw.vector));
    const candidate: LegacyVectorCandidate = {
      id: raw.id,
      vector: normalizedVector,
      metadata: (raw.meta ?? {}) as Record<string, unknown>,
      digest: digestJson({
        id: raw.id,
        vector: normalizedVector,
        metadata: raw.meta ?? {},
      }),
    };
    if (byId.has(raw.id)) {
      const supersededLine = sourceLineById.get(raw.id)!;
      skipped.push({
        family: "vector",
        source: `${LEGACY_VECTORS_FILE}:${supersededLine}`,
        reason: `entry was superseded by line ${index + 1} for vector id '${raw.id}'`,
        contentSha256: byId.get(raw.id)!.digest,
      });
    }
    byId.set(raw.id, candidate);
    sourceLineById.set(raw.id, index + 1);
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function preflightKv(
  candidates: LegacyKvCandidate[],
  store: SyncStore,
  pending: PendingWrites,
  counts: LegacyImportFamilyCounts,
  conflicts: LegacyImportConflict[],
): void {
  for (const candidate of candidates) {
    if (candidate.expiresAt !== undefined) {
      const record = {
        id: candidate.key,
        key: candidate.key,
        value: candidate.value,
        expiresAt: candidate.expiresAt,
        sha256: candidate.digest,
      };
      const existing = getByIdOrNull<typeof record>(store, LEGACY_TTL_COLLECTION, record.id);
      if (existing === null) {
        pending.kv.push(candidate);
      } else if (
        existing.key === candidate.key &&
        existing.expiresAt === candidate.expiresAt &&
        digestJson(existing.value) === digestJson(candidate.value)
      ) {
        counts.identical++;
      } else if (digestJson(existing) !== digestJson(record)) {
        conflicts.push({
          family: "kv",
          key: candidate.key,
          reason: "destination quarantined TTL record differs",
        });
      }
      continue;
    }

    if (!store.has(candidate.key)) {
      pending.kv.push(candidate);
    } else if (digestJson(store.get(candidate.key)) === digestJson(candidate.value)) {
      counts.identical++;
    } else {
      conflicts.push({ family: "kv", key: candidate.key, reason: "destination value differs" });
    }
  }
}

function preflightBlobs(
  candidates: LegacyBlobCandidate[],
  store: SyncStore,
  pending: PendingWrites,
  counts: LegacyImportFamilyCounts,
  conflicts: LegacyImportConflict[],
): void {
  for (const candidate of candidates) {
    const existing = getByIdOrNull<LegacyBlobCandidate>(
      store,
      LEGACY_BLOBS_COLLECTION,
      candidate.key,
    );
    if (existing === null) {
      pending.blobs.push(candidate);
    } else if (
      existing.bytesBase64 === candidate.bytesBase64 &&
      existing.mimeType === candidate.mimeType
    ) {
      counts.identical++;
    } else {
      conflicts.push({ family: "blob", key: candidate.key, reason: "destination blob differs" });
    }
  }
}

function preflightLogs(
  candidates: LegacyLogCandidate[],
  fileSize: number | undefined,
  store: SyncStore,
  pending: PendingWrites,
  counts: LegacyImportFamilyCounts,
  conflicts: LegacyImportConflict[],
): void {
  for (const candidate of candidates) {
    const existing = getByIdOrNull<LegacyLogCandidate>(
      store,
      LEGACY_LOG_COLLECTION,
      candidate.id,
    );
    if (existing === null) {
      pending.logs.push(candidate);
    } else if (
      existing.offset === candidate.offset &&
      digestJson(existing.record) === digestJson(candidate.record)
    ) {
      counts.identical++;
    } else {
      conflicts.push({ family: "log", key: candidate.id, reason: "destination log record differs" });
    }
  }
  if (fileSize !== undefined) {
    const record = { id: LEGACY_NEXT_LOG_OFFSET_ID, value: fileSize };
    const existing = getByIdOrNull<typeof record>(store, LEGACY_META_COLLECTION, record.id);
    if (existing === null) {
      pending.logMeta = record;
    } else if (digestJson(existing) !== digestJson(record)) {
      conflicts.push({
        family: "log",
        key: LEGACY_NEXT_LOG_OFFSET_ID,
        reason: "destination next-log offset differs",
      });
    }
  }
}

function preflightVectors(
  candidates: LegacyVectorCandidate[],
  store: VectorStore,
  pending: PendingWrites,
  counts: LegacyImportFamilyCounts,
  conflicts: LegacyImportConflict[],
): void {
  for (const candidate of candidates) {
    const existing = store.get(LEGACY_VECTOR_COLLECTION, candidate.id);
    if (existing === null) {
      pending.vectors.push(candidate);
      continue;
    }
    const normalized = {
      id: existing.id,
      vector: Array.from(existing.vector),
      metadata: existing.metadata ?? {},
    };
    if (
      digestJson(normalized) ===
      digestJson({
        id: candidate.id,
        vector: candidate.vector,
        metadata: candidate.metadata,
      })
    ) {
      counts.identical++;
    } else {
      conflicts.push({ family: "vector", key: candidate.id, reason: "destination vector differs" });
    }
  }
}

function writePending(
  kv: SyncStore,
  vector: VectorStore | undefined,
  pending: PendingWrites,
  counts: Record<LegacyImportFamily, LegacyImportFamilyCounts>,
): void {
  for (const candidate of pending.kv) {
    if (candidate.expiresAt !== undefined) {
      kv.put(LEGACY_TTL_COLLECTION, {
        id: candidate.key,
        key: candidate.key,
        value: candidate.value,
        expiresAt: candidate.expiresAt,
        sha256: candidate.digest,
      });
    } else {
      kv.set(candidate.key, candidate.value);
    }
    counts.kv.written++;
  }
  for (const candidate of pending.blobs) {
    kv.put(LEGACY_BLOBS_COLLECTION, {
      id: candidate.key,
      bytesBase64: candidate.bytesBase64,
      ...(candidate.mimeType ? { mimeType: candidate.mimeType } : {}),
      sha256: candidate.digest,
    });
    counts.blob.written++;
  }
  for (const candidate of pending.logs) {
    kv.put(LEGACY_LOG_COLLECTION, {
      id: candidate.id,
      offset: candidate.offset,
      record: candidate.record,
      sha256: candidate.digest,
    });
    counts.log.written++;
  }
  if (pending.logMeta) kv.put(LEGACY_META_COLLECTION, pending.logMeta);
  if (pending.vectors.length > 0 && !vector) {
    throw new Error("Legacy vector destination disappeared after preflight");
  }
  for (const candidate of pending.vectors) {
    vector!.upsert(LEGACY_VECTOR_COLLECTION, {
      id: candidate.id,
      vector: Float32Array.from(candidate.vector),
      metadata: candidate.metadata,
    });
    counts.vector.written++;
  }
}

function initialCounts(source: ParsedLegacySource): Record<LegacyImportFamily, LegacyImportFamilyCounts> {
  const eligible = {
    kv: source.kv.length,
    blob: source.blobs.length,
    log: source.logs.length,
    vector: source.vectors.length,
  };
  const result = {} as Record<LegacyImportFamily, LegacyImportFamilyCounts>;
  for (const family of ["kv", "blob", "log", "vector"] as const) {
    result[family] = {
      discovered: source.discovered[family],
      eligible: eligible[family],
      written: 0,
      identical: 0,
      skipped: source.skipped.filter((issue) => issue.family === family).length,
      invalid: source.invalid.filter((issue) => issue.family === family).length,
    };
  }
  return result;
}

function familyDigests(source: ParsedLegacySource): Record<LegacyImportFamily, string> {
  return {
    kv: digestJson(source.kv.map(({ key, digest }) => ({ key, digest }))),
    blob: digestJson(source.blobs.map(({ key, digest }) => ({ key, digest }))),
    log: digestJson(source.logs.map(({ id, digest }) => ({ id, digest }))),
    vector: digestJson(source.vectors.map(({ id, digest }) => ({ id, digest }))),
  };
}

function sourceManifest(sourceDir: string): LegacySourceManifestEntry[] {
  const paths: string[] = [];
  for (const name of [LEGACY_KV_FILE, LEGACY_LOG_FILE, LEGACY_VECTORS_FILE]) {
    const path = join(sourceDir, name);
    if (existsSync(path) && lstatSync(path).isFile()) paths.push(path);
  }
  const blobDir = join(sourceDir, LEGACY_BLOBS_DIR);
  if (existsSync(blobDir)) {
    for (const file of walkFiles(blobDir)) paths.push(join(blobDir, ...file.split("/")));
  }
  return paths
    .map((path) => {
      const bytes = readFileSync(path);
      return {
        path: relative(sourceDir, path).split("\\").join("/"),
        size: bytes.byteLength,
        sha256: sha256(bytes),
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

function assertSourceBoundary(sourceDir: string): void {
  const rootStat = lstatSync(sourceDir);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error("Legacy store source must be a real directory, not a symlink or special file");
  }
  for (const name of [LEGACY_KV_FILE, LEGACY_LOG_FILE, LEGACY_VECTORS_FILE]) {
    const path = join(sourceDir, name);
    if (!existsSync(path)) continue;
    const entry = lstatSync(path);
    if (entry.isSymbolicLink() || !entry.isFile()) {
      throw new Error(`Legacy store source entry '${name}' must be a regular file, not a symlink`);
    }
  }
  const blobDir = join(sourceDir, LEGACY_BLOBS_DIR);
  if (existsSync(blobDir)) {
    const entry = lstatSync(blobDir);
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new Error("Legacy store blobs entry must be a real directory, not a symlink");
    }
    walkFiles(blobDir);
  }
}

function assertSourceUnchanged(sourceDir: string, expectedManifestDigest: string): void {
  assertSourceBoundary(resolve(sourceDir));
  const currentDigest = digestJson(sourceManifest(resolve(sourceDir)));
  if (currentDigest !== expectedManifestDigest) {
    throw new Error("Legacy store source changed while the import was being prepared; retry from a quiescent source");
  }
}

function walkFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    const entries: Dirent[] = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (entry.isFile()) {
        out.push(relative(root, absolute).split("\\").join("/"));
      } else if (entry.isSymbolicLink()) {
        throw new Error(
          `Legacy store source contains a symlink outside the supported boundary: ${relative(root, absolute)}`,
        );
      }
    }
  };
  walk(root);
  return out.sort();
}

function isStoredReceipt(
  record: StoredReceiptRecord,
  markerId: string,
  manifestDigest: string,
  destination: ResolvedDestination,
  packageVersions: LegacyImportReceipt["packages"],
): boolean {
  const receipt = record.receipt;
  if (!receipt || typeof receipt.receiptSha256 !== "string") return false;
  const { receiptSha256, ...unsigned } = receipt;
  return (
    digestJson(unsigned) === receiptSha256 &&
    record.id === markerId &&
    receipt.schemaVersion === 1 &&
    receipt.status === "applied" &&
    receipt.mode === "write" &&
    receipt.markerId === markerId &&
    receipt.source?.manifestSha256 === manifestDigest &&
    receipt.destination?.identity === destination.identity &&
    receipt.destination?.namespace === destination.namespace &&
    receipt.destination?.tier === destination.tier &&
    digestJson(receipt.packages) === digestJson(packageVersions)
  );
}

function totalPending(pending: PendingWrites): number {
  return (
    pending.kv.length +
    pending.blobs.length +
    pending.logs.length +
    pending.vectors.length +
    (pending.logMeta ? 1 : 0)
  );
}

function withReceiptDigest(
  receipt: Omit<LegacyImportReceipt, "receiptSha256">,
): LegacyImportReceipt {
  return { ...receipt, receiptSha256: digestJson(receipt) };
}

function resolvePackageVersions(overrides?: LegacyImportPackageVersions): LegacyImportReceipt["packages"] {
  if (!overrides || !isSafeVersion(overrides.source)) {
    throw new Error(
      "Legacy import requires packageVersions.source because legacy files do not record which @gonk/store version wrote them",
    );
  }
  const importerVersion =
    overrides.importer ??
    packageVersionFrom(dirname(fileURLToPath(import.meta.url)), "@gonk/store");
  const destinationVersion =
    overrides?.destination ??
    dependencyPackageVersionFrom(dirname(fileURLToPath(import.meta.url)), "@mirk/store");
  if (!isSafeVersion(importerVersion) || !isSafeVersion(destinationVersion)) {
    throw new Error("Legacy import package versions must be non-empty printable strings");
  }
  return {
    source: { name: "@gonk/store", version: overrides.source },
    importer: { name: "@gonk/store", version: importerVersion },
    destination: { name: "@mirk/store", version: destinationVersion },
  };
}

function dependencyPackageVersionFrom(start: string, expectedName: string): string {
  let current = resolve(start);
  const packageSegments = expectedName.split("/");
  while (true) {
    const candidate = join(current, "node_modules", ...packageSegments, "package.json");
    if (existsSync(candidate)) {
      const parsed = JSON.parse(readFileSync(candidate, "utf8")) as {
        name?: unknown;
        version?: unknown;
      };
      if (parsed.name === expectedName && typeof parsed.version === "string") return parsed.version;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`Could not resolve dependency package version for ${expectedName}`);
}

function packageVersionFrom(start: string, expectedName: string): string {
  let current = resolve(start);
  while (true) {
    const packagePath = join(current, "package.json");
    if (existsSync(packagePath)) {
      const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as {
        name?: unknown;
        version?: unknown;
      };
      if (parsed.name === expectedName && typeof parsed.version === "string") return parsed.version;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`Could not resolve package version for ${expectedName}`);
}

function validTimestamp(value: Date, phase: string): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`Legacy import ${phase} clock returned an invalid Date`);
  }
  return value.toISOString();
}

function isSafeVersion(version: string): boolean {
  return version.length > 0 && version.length <= 128 && /^[\x20-\x7e]+$/.test(version);
}

function assertSafeIdentity(identity: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(identity)) {
    throw new Error(
      "Legacy import destination identity must be 1-128 characters using only letters, numbers, dot, underscore, or hyphen",
    );
  }
}

function assertNamespaceLabel(namespace: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(namespace)) {
    throw new Error(
      "Legacy import destination namespace must be 1-128 characters using only letters, numbers, dot, underscore, or hyphen",
    );
  }
}

function getByIdOrNull<T>(store: SyncStore, collection: string, id: string): T | null {
  try {
    return store.getById<T>(collection, id);
  } catch (error) {
    // Mirk's SQLite facet materializes collection tables on first write. A read
    // after a rolled-back first write can therefore report an absent table.
    if (error instanceof Error && error.message.startsWith("no such table:")) return null;
    throw error;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function digestJson(value: unknown): string {
  return sha256(canonicalJson(value));
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Legacy import encountered a non-JSON value");
  return encoded;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
