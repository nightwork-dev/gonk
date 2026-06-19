/**
 * VerbPickerTuiComponent — reusable command-discovery TUI component.
 *
 * Implements Pi's `PiTuiComponent` interface so it can be used directly
 * with `ctx.host.piCtx.ui.custom(factory)`.  Surfaces available subcommand
 * verbs in a navigable list; prompts for an argument when the selected verb
 * requires one.
 *
 * Keybindings:
 *   ↑ / k      move cursor up
 *   ↓ / j      move cursor down
 *   1-9        jump directly to verb at that position
 *   Enter      run selected verb (prompt for arg if requiresArg)
 *   q / Esc    cancel
 */

import type { PiTheme, PiTuiComponent } from "./pi-types.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface Verb {
  /** Verb id, e.g. "speak", "listen", "recall". */
  id: string;
  /** Display label.  Defaults to id when omitted. */
  label?: string;
  /** One-line description shown next to the verb. */
  description: string;
  /** True if the verb takes a positional / free-text arg. */
  requiresArg?: boolean;
  /** Example arg shown as a placeholder when prompting. */
  exampleArg?: string;
}

export interface PiTuiHostHooks {
  /** Pi's `ctx.ui.input(prompt, default)` — prompts for inline input. */
  input?: (prompt: string, defaultValue?: string) => Promise<string | undefined>;
}

export interface VerbPickerTuiOptions {
  verbs: readonly Verb[];
  /** Header text above the verb list.  e.g. "Available voice commands:" */
  header: string;
  /** Footer hint.  Default: "↑↓ navigate · Enter run · q quit". */
  footer?: string;
  /** Maximum verbs visible at once before scrolling.  Default 10. */
  pageSize?: number;
  /** Called when the user picks a verb (and arg, if requiresArg). */
  onSelect: (verb: Verb, arg: string | undefined) => void;
  /** Called when the user cancels (q / Esc). */
  onCancel: () => void;
  /** Bounds each rendered line to the terminal width (ANSI-aware). Pass
   *  pi-tui's `truncateToWidth`. pi-tui throws on any rendered line wider than
   *  the terminal, so this is required — there is no safe no-op. The optional
   *  `ellipsis` / `pad` params match pi-tui's signature: pass `("", true)` to
   *  right-pad a left-aligned cell to exactly `width` visible columns. */
  truncate: (text: string, width: number, ellipsis?: string, pad?: boolean) => string;
}

// ---------------------------------------------------------------------------
// Key helpers (inline — no dep on @earendil-works/pi-tui from this file)
// ---------------------------------------------------------------------------

const UP_SEQUENCES = ["\x1b[A", "\x1b[a"];
const DOWN_SEQUENCES = ["\x1b[B", "\x1b[b"];
const ENTER_SEQUENCES = ["\r", "\n", "\x0a", "\x0d"];
const ESC_SEQUENCES = ["\x1b", "\x1b\x1b"];
const QUIT_KEYS = ["q", "Q"];

function matchUp(data: string): boolean {
  return UP_SEQUENCES.includes(data) || data === "k";
}

function matchDown(data: string): boolean {
  return DOWN_SEQUENCES.includes(data) || data === "j";
}

function matchEnter(data: string): boolean {
  return ENTER_SEQUENCES.includes(data);
}

function matchCancel(data: string): boolean {
  return ESC_SEQUENCES.includes(data) || QUIT_KEYS.includes(data);
}

function matchDigit(data: string): number | null {
  if (data.length === 1 && data >= "1" && data <= "9") {
    return parseInt(data, 10);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export class VerbPickerTuiComponent implements PiTuiComponent {
  private _cursor = 0;
  private _pending = false; // true while awaiting arg input

  private readonly _verbs: readonly Verb[];
  private readonly _pageSize: number;
  private readonly _theme: PiTheme;
  private readonly _hooks: PiTuiHostHooks;
  private readonly _opts: VerbPickerTuiOptions;

  constructor(
    options: VerbPickerTuiOptions,
    theme: PiTheme,
    hostHooks: PiTuiHostHooks,
  ) {
    this._opts = options;
    this._verbs = options.verbs;
    this._pageSize = options.pageSize ?? 10;
    this._theme = theme;
    this._hooks = hostHooks;
    this._cursor = 0;
  }

  // -------------------------------------------------------------------------
  // PiTuiComponent contract
  // -------------------------------------------------------------------------

  invalidate(): void {
    // No cached layout.
  }

  handleInput(data: string): void {
    // While we are awaiting an async arg prompt, ignore further input.
    if (this._pending) return;

    if (matchCancel(data)) {
      this._opts.onCancel();
      return;
    }

    if (matchUp(data)) {
      this._moveCursor(-1);
      return;
    }

    if (matchDown(data)) {
      this._moveCursor(1);
      return;
    }

    const digit = matchDigit(data);
    if (digit !== null) {
      const idx = digit - 1; // 1-based → 0-based
      if (idx < this._verbs.length) {
        this._cursor = idx;
        this._selectCurrent();
      }
      return;
    }

    if (matchEnter(data)) {
      this._selectCurrent();
      return;
    }
  }

  render(width: number): string[] {
    const th = this._theme;
    const lines: string[] = [];

    lines.push("");

    // Header
    lines.push(
      this._pad(th.fg("accent", this._opts.header), width),
    );
    lines.push(
      this._pad(th.fg("borderMuted", "─".repeat(Math.max(1, width - 4))), width),
    );
    lines.push("");

    if (this._verbs.length === 0) {
      lines.push(this._pad(th.fg("dim", "(no verbs)"), width));
      lines.push("");
    } else {
      // Compute label column width from the widest label.
      const labelWidth = Math.min(
        20,
        Math.max(...this._verbs.map((v) => (v.label ?? v.id).length)) + 2,
      );

      // Scroll window.
      const pageSize = Math.min(this._pageSize, this._verbs.length);
      const scrollOffset = Math.max(
        0,
        Math.min(this._cursor - pageSize + 1, this._verbs.length - pageSize),
      );

      for (let i = scrollOffset; i < scrollOffset + pageSize; i++) {
        const verb = this._verbs[i];
        if (!verb) break;
        const isSel = i === this._cursor;
        const cursor = isSel ? th.fg("accent", "▶ ") : "  ";
        const label = this._opts.truncate(verb.label ?? verb.id, labelWidth, "", true);
        const labelTxt = isSel ? th.fg("accent", label) : label;
        const argHint = verb.requiresArg
          ? th.fg("dim", ` <${verb.exampleArg ?? "arg"}>`)
          : "";
        const desc = th.fg("muted", verb.description);
        lines.push(
          this._truncate(
            `  ${cursor}${labelTxt}  ${desc}${argHint}`,
            width,
          ),
        );
      }

      if (this._verbs.length > pageSize) {
        lines.push("");
        lines.push(
          this._pad(
            th.fg("dim", `  ${scrollOffset + 1}–${Math.min(scrollOffset + pageSize, this._verbs.length)} of ${this._verbs.length}`),
            width,
          ),
        );
      }
    }

    lines.push("");
    const footer =
      this._opts.footer ?? "↑↓ navigate · Enter run · q quit";
    lines.push(this._pad(th.fg("dim", `  ${footer}`), width));
    lines.push("");
    return lines.map((l) => this._opts.truncate(l, width));
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private _moveCursor(delta: number): void {
    if (this._verbs.length === 0) return;
    this._cursor =
      ((this._cursor + delta) % this._verbs.length + this._verbs.length) %
      this._verbs.length;
  }

  private _selectCurrent(): void {
    const verb = this._verbs[this._cursor];
    if (!verb) return;

    if (verb.requiresArg) {
      // Guard against multiple invocations while awaiting.
      this._pending = true;
      const prompt = verb.label ?? verb.id;
      const placeholder = verb.exampleArg;
      void this._hooks
        .input?.(prompt, placeholder)
        .then((arg) => {
          this._pending = false;
          this._opts.onSelect(verb, arg);
        })
        .catch(() => {
          this._pending = false;
          this._opts.onCancel();
        });
    } else {
      this._opts.onSelect(verb, undefined);
    }
  }

  private _truncate(text: string, width: number): string {
    return this._opts.truncate(text, width);
  }

  private _pad(text: string, width: number): string {
    return this._opts.truncate(`  ${text}`, width);
  }
}
