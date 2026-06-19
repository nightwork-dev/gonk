import type { ScopeName, ScopeStore } from "@gonk/scope";
import type { SettingsItem, SettingsSpec } from "@gonk/extension-spec";

import {
  clearSettingValue,
  cycleValue,
  isCyclable,
  readSettingValue,
  writeSettingValue,
} from "./settings.ts";
import type { PiTheme, PiTuiComponent } from "./pi-types.ts";

const TIERS: ScopeName[] = ["session", "directory", "project", "persona", "global"];

/** Action emitted by the TUI when an item needs an external editor flow
 *  (model picker, voice picker, free-text input, etc.). The runtime
 *  handles each kind by delegating to host-specific UI primitives. */
export type SettingsTuiAction =
  | { kind: "close" }
  | { kind: "edit"; item: SettingsItem; tier: ScopeName };

interface Row {
  kind: "header" | "item";
  label?: string;
  item?: SettingsItem;
}

/** Callbacks the host runtime supplies for behaviors the TUI itself can't
 *  perform without leaving the component (matches Pi's TUI lifecycle —
 *  enter the picker / editor outside the custom() callback). */
export interface SettingsTuiKb {
  matchesKey(data: string, key: string): boolean;
  parseKey(data: string): string | undefined;
}

export interface SettingsTuiOptions {
  scope: ScopeStore;
  spec: SettingsSpec;
  theme: PiTheme;
  kb: SettingsTuiKb;
  truncate: (text: string, width: number, ellipsis?: string, pad?: boolean) => string;
  onAction: (action: SettingsTuiAction) => void;
}

/** Schema-driven settings TUI. Extracted from VoiceConfigComponent /
 *  ImageConfigComponent which were ~250 LOC each of nearly-identical code.
 *
 *  Renders sections as headers + key/value rows. Cyclable items (enum,
 *  boolean) toggle in place via Enter / arrow keys. Other items emit an
 *  `edit` action so the host can run the appropriate picker or input flow.
 */
export class SettingsTuiComponent implements PiTuiComponent {
  private readonly opts: SettingsTuiOptions;
  private readonly rows: Row[];
  private readonly firstItemIdx: number;
  private rowIdx: number;
  private writeTier: ScopeName = "global";
  private message: string = "";

  constructor(opts: SettingsTuiOptions) {
    this.opts = opts;
    this.rows = buildRows(opts.spec);
    this.firstItemIdx = this.rows.findIndex((r) => r.kind === "item");
    this.rowIdx = this.firstItemIdx >= 0 ? this.firstItemIdx : 0;
  }

  invalidate(): void {
    // no cache; nothing to do
  }

  handleInput(data: string): void {
    const { kb } = this.opts;
    if (kb.matchesKey(data, "escape") || kb.matchesKey(data, "ctrl+c")) {
      this.opts.onAction({ kind: "close" });
      return;
    }
    if (kb.matchesKey(data, "up")) return this.moveSelection(-1);
    if (kb.matchesKey(data, "down")) return this.moveSelection(1);

    if (kb.matchesKey(data, "tab")) {
      const i = TIERS.indexOf(this.writeTier);
      this.writeTier = TIERS[(i + 1) % TIERS.length]!;
      this.message = `write tier → ${this.writeTier}`;
      return;
    }

    // Number-jump tier: 1=session, 2=directory, 3=project, 4=global
    const ch = kb.parseKey(data);
    const numericTiers: Record<string, ScopeName> = {
      "1": "session",
      "2": "directory",
      "3": "project",
      "4": "global",
    };
    if (ch && numericTiers[ch]) {
      this.writeTier = numericTiers[ch]!;
      this.message = `write tier → ${this.writeTier}`;
      return;
    }

    if (kb.matchesKey(data, "enter") || kb.matchesKey(data, "right")) {
      this.activateSelected(+1);
      return;
    }
    if (kb.matchesKey(data, "left")) {
      this.activateSelected(-1);
      return;
    }

    if (kb.matchesKey(data, "delete") || kb.matchesKey(data, "backspace")) {
      const item = this.selectedItem();
      if (!item) return;
      try {
        clearSettingValue(this.opts.scope, item, this.writeTier);
        this.message = `${item.label} cleared @ ${this.writeTier}`;
      } catch (err) {
        this.message = `error: ${err instanceof Error ? err.message : String(err)}`;
      }
      return;
    }
  }

  render(width: number): string[] {
    const th = this.opts.theme;
    const trunc = this.opts.truncate;
    const lines: string[] = [];

    lines.push("");
    const title = th.fg("accent", " Settings ");
    lines.push(
      trunc(
        th.fg("borderMuted", "─".repeat(3)) +
          title +
          th.fg("borderMuted", "─".repeat(Math.max(0, width - 13))),
        width,
      ),
    );
    lines.push("");
    lines.push(
      trunc(
        `  ${th.fg("muted", "↑↓ nav · Enter/← → cycle/edit · 1-4 tier · Tab tier · Del clear · Esc close")}`,
        width,
      ),
    );
    lines.push(
      trunc(
        `  ${th.fg("muted", "write tier:")} ${th.fg("accent", this.writeTier)}`,
        width,
      ),
    );
    lines.push("");

    const labelWidth =
      Math.max(
        ...this.rows
          .filter((r): r is Row & { kind: "item"; item: SettingsItem } => r.kind === "item")
          .map((r) => r.item.label.length),
      ) + 2;

    for (let i = 0; i < this.rows.length; i++) {
      const row = this.rows[i]!;
      if (row.kind === "header") {
        lines.push(
          trunc(
            `  ${th.fg("accent", row.label ?? "")} ${th.fg("borderMuted", "─".repeat(Math.max(0, width - (row.label?.length ?? 0) - 4)))}`,
            width,
          ),
        );
        continue;
      }
      const item = row.item!;
      const isSel = i === this.rowIdx;
      const value = readSettingValue(this.opts.scope, item);
      const display =
        value === undefined
          ? `(default: ${formatDefault(item.default)})`
          : formatValue(value);
      const sourceTier = describeSource(this.opts.scope, item);
      const cursor = isSel ? th.fg("accent", "▶ ") : "  ";
      const label = trunc("  " + item.label + ":", labelWidth, "", true);
      const valTxt = isSel ? th.fg("accent", display) : display;
      const tierTxt = th.fg("dim", ` [${sourceTier}]`);
      lines.push(trunc(`${cursor}${label}${valTxt}${tierTxt}`, width));
    }

    if (this.message) {
      lines.push("");
      lines.push(trunc(`  ${th.fg("muted", this.message)}`, width));
    }
    lines.push("");
    return lines.map((l) => trunc(l, width));
  }

  private moveSelection(direction: 1 | -1): void {
    const n = this.rows.length;
    let i = this.rowIdx;
    for (let step = 0; step < n; step++) {
      i = (i + direction + n) % n;
      if (this.rows[i]?.kind === "item") {
        this.rowIdx = i;
        this.message = "";
        return;
      }
    }
  }

  private selectedItem(): SettingsItem | undefined {
    const row = this.rows[this.rowIdx];
    return row?.kind === "item" ? row.item : undefined;
  }

  private activateSelected(direction: 1 | -1): void {
    const item = this.selectedItem();
    if (!item) return;

    if (isCyclable(item.type)) {
      const current = readSettingValue(this.opts.scope, item) ?? item.default;
      const next = cycleValue(item.type, current, direction);
      if (next === undefined) return;
      try {
        writeSettingValue(this.opts.scope, item, next, this.writeTier);
        this.message = `${item.label} = ${formatValue(next)} @ ${this.writeTier}`;
      } catch (err) {
        this.message = `error: ${err instanceof Error ? err.message : String(err)}`;
      }
      return;
    }

    // Non-cyclable: leave the TUI for an external editor / picker flow.
    this.opts.onAction({ kind: "edit", item, tier: this.writeTier });
  }
}

function buildRows(spec: SettingsSpec): Row[] {
  const out: Row[] = [];
  const showHeaders = spec.sections.length > 1;
  for (const section of spec.sections) {
    if (showHeaders) out.push({ kind: "header", label: section.label });
    for (const item of section.items) {
      out.push({ kind: "item", item });
    }
  }
  return out;
}

function describeSource(scope: ScopeStore, item: SettingsItem): string {
  // For keyedBy items, show the index value rather than the resolved source tier.
  if (item.keyedBy) {
    const idx =
      typeof item.keyedBy.source === "function"
        ? item.keyedBy.source(scope)
        : scope.get<string>(item.keyedBy.source);
    return idx ? `for: ${idx}` : "for: (no index)";
  }
  const resolved = scope.resolve<unknown>(item.key);
  return resolved.length > 0 ? resolved[0]!.scope : "default";
}

function formatDefault(d: unknown): string {
  if (d === undefined) return "(unset)";
  return formatValue(d);
}

function formatValue(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
