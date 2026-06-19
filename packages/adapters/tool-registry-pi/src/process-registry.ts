/**
 * Process-wide registry of `ToolDefinition`s registered through
 * `registerGonkTools` and gonk extensions that registered through
 * `registerSpecExtension`. Lets a tool inside one Pi extension introspect
 * tools / extensions registered by *every* extension that has been wired
 * through the spec framework — without each extension having to plumb its
 * registry through.
 *
 * Why a module-level singleton?
 *   Pi's `ExtensionAPI` doesn't expose a "list registered tools" or "list
 *   loaded extensions" surface. To answer "what tools does the agent have
 *   right now?" / "which gonk extensions are loaded?" from inside one
 *   extension (e.g. pi-introspect's `tool_explain` / `harness_status`), we
 *   need somewhere to hold the union of all known ToolDefinitions +
 *   extension records in the process. The natural place is the package
 *   every Pi-side registration funnels through: `tool-registry-pi`.
 *
 *   The singleton lives on `globalThis` keyed by a Symbol so multiple
 *   bundled copies of `tool-registry-pi` (which can happen with workspace
 *   `workspace:*` deps + tsup `noExternal` patterns) still see the same
 *   registry. Last-write-wins per tool name / package name across
 *   registrations — which matches Pi's own behavior, where calling
 *   `registerTool` with a conflicting name overrides the prior tool.
 *
 * What it is NOT:
 *   - Not a registry the Orchestrator consults — Orchestrator owns its own
 *     registries explicitly.
 *   - Not a way for tools to invoke each other — there is no cross-tool
 *     `invoke()` here. This is purely an introspection mirror.
 *   - Not authoritative about *Pi's* registered tools / extensions — Pi may
 *     have registered tools or loaded extensions through paths that don't
 *     go through `registerGonkTools` / `registerSpecExtension` (its
 *     built-in tools, third-party Pi extensions that don't use the gonk
 *     spec framework). This registry only tracks gonk-spec extensions and
 *     their tools.
 */

import type {
  CapabilityReadiness,
  CapabilityState,
  ToolDefinition,
} from "@gonk/tool-registry";

const REGISTRY_KEY = Symbol.for("@gonk/tool-registry-pi:process-registry");

/** Record of a gonk extension that has been wired into the host. Recorded
 *  by `registerSpecExtension` (and CLI / MCP equivalents) at extension
 *  setup time. */
export interface GonkExtensionRecord {
  /** Stable spec id (e.g. "introspect", "memory", "gonk"). Comes from
   *  `ExtensionSpec.id`. */
  specId: string;
  /** npm package name (e.g. "@gonk/pi-introspect"). Optional because
   *  some hosts may not have a package identity (e.g. tests). */
  packageName?: string;
  /** Wall-clock timestamp at registration. Useful for "loaded at" output. */
  loadedAt: number;
  /** Capability readiness descriptors declared on the extension's spec.
   *  Recorded here so status surfaces (`harness_status`, `doctor`) can report
   *  a capability even when its tool was dropped by a false `requires()`. */
  readiness?: CapabilityReadiness[];
}

interface ProcessRegistryStore {
  /** Tools keyed by name. Last-write-wins on duplicate registration. */
  tools: Map<string, ToolDefinition>;
  /** Loaded extensions keyed by package name (when known) or spec id.
   *  Last-write-wins on duplicate registration — matches the tools rule. */
  extensions: Map<string, GonkExtensionRecord>;
}

interface GlobalWithRegistry {
  [REGISTRY_KEY]?: ProcessRegistryStore;
}

function store(): ProcessRegistryStore {
  const g = globalThis as unknown as GlobalWithRegistry;
  let s = g[REGISTRY_KEY];
  if (!s) {
    s = { tools: new Map(), extensions: new Map() };
    g[REGISTRY_KEY] = s;
  }
  // Migration for in-process upgrades: an older bundle may have created the
  // store without an `extensions` map. Backfill it so we don't crash.
  if (!s.extensions) s.extensions = new Map();
  return s;
}

/** Record a `ToolDefinition` in the process-wide gonk registry. Idempotent
 *  — repeat calls with the same `tool.name` overwrite the prior entry, so a
 *  hot-reload / re-registration in tests doesn't accumulate stale entries. */
export function recordGonkTool(tool: ToolDefinition): void {
  store().tools.set(tool.name, tool);
}

/** Return the live ToolDefinition list. The array is a snapshot (callers
 *  can mutate it freely without affecting the registry). */
export function listGonkTools(): ToolDefinition[] {
  return Array.from(store().tools.values());
}

/** Look up a single ToolDefinition by name. Returns `undefined` when the
 *  name has never been recorded in this process. */
export function findGonkTool(name: string): ToolDefinition | undefined {
  return store().tools.get(name);
}

/** Drop every recorded tool. Intended for test isolation; production
 *  callers should never need to clear the registry. */
export function clearGonkTools(): void {
  store().tools.clear();
}

/** Record a gonk extension load in the process-wide registry. Called by
 *  `registerSpecExtension` (and CLI / MCP equivalents) at setup time so
 *  introspection tools (`harness_status`) can answer "which extensions are
 *  loaded?" without dynamic-import probing — which is fragile when the
 *  caller's cwd resolves package names against a different node_modules
 *  tree than the one Pi loaded the extension from.
 *
 *  Keyed by `packageName` when provided, otherwise by `specId`. Repeat
 *  calls overwrite the prior entry. */
export function recordGonkExtension(
  record: Omit<GonkExtensionRecord, "loadedAt"> & { loadedAt?: number },
): void {
  const key = record.packageName ?? record.specId;
  const full: GonkExtensionRecord = {
    specId: record.specId,
    ...(record.packageName !== undefined ? { packageName: record.packageName } : {}),
    ...(record.readiness !== undefined ? { readiness: record.readiness } : {}),
    loadedAt: record.loadedAt ?? Date.now(),
  };
  store().extensions.set(key, full);
}

/** Return the live extension list as a snapshot. Order is insertion order
 *  (first-loaded first), matching Pi's setup order. */
export function listGonkExtensions(): GonkExtensionRecord[] {
  return Array.from(store().extensions.values());
}

/** Look up an extension record by package name or spec id. Returns
 *  `undefined` if neither matches. Package name takes precedence; we then
 *  fall back to a linear scan for spec id (since two extensions could
 *  share a spec id from different packages, last-write-wins). */
export function findGonkExtension(nameOrId: string): GonkExtensionRecord | undefined {
  const exts = store().extensions;
  const direct = exts.get(nameOrId);
  if (direct) return direct;
  for (const ext of exts.values()) {
    if (ext.specId === nameOrId) return ext;
  }
  return undefined;
}

/** Drop every recorded extension. Intended for test isolation. */
export function clearGonkExtensions(): void {
  store().extensions.clear();
}

/** A capability's resolved readiness — `CapabilityState` flattened with its
 *  id + label. The shared shape both `harness_status` (agent) and `doctor`
 *  (human) render. */
export interface CapabilityReport {
  id: string;
  label: string;
  status: "ready" | "degraded" | "needs-setup";
  detail?: string;
  fix?: string;
  settingsKeys?: string[];
}

/** Run every recorded extension's readiness probes and flatten to a sorted
 *  report. Reads the process-wide registry by default; tests inject a fake
 *  provider. A probe that throws is reported as needs-setup rather than
 *  crashing the report — one misconfigured extension shouldn't blind the rest.
 *
 *  Single collector behind both status surfaces so the agent's `harness_status`
 *  and the human's `doctor` can't diverge. */
export function probeReadiness(
  provider: () => GonkExtensionRecord[] = listGonkExtensions,
): CapabilityReport[] {
  const out: CapabilityReport[] = [];
  for (const ext of provider()) {
    for (const r of ext.readiness ?? []) {
      let state: CapabilityState;
      try {
        state = r.probe();
      } catch {
        state = {
          status: "needs-setup",
          detail: "readiness probe threw",
          fix: "check the extension's configuration wiring",
        };
      }
      const report: CapabilityReport = { id: r.id, label: r.label, status: state.status };
      if ("detail" in state && state.detail !== undefined) report.detail = state.detail;
      if ("fix" in state) report.fix = state.fix;
      if ("settingsKeys" in state && state.settingsKeys !== undefined) {
        report.settingsKeys = state.settingsKeys;
      }
      out.push(report);
    }
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}
