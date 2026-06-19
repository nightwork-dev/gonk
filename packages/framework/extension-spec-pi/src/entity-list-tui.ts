/**
 * Reusable base for entity-list TUIs (the Persona TUI shape; future
 * candidates: tools list, presets list, providers list).
 *
 * Provides:
 *   - selection state (rowIdx) with bounded nav (Up/Down)
 *   - search overlay with `/` to enter, Esc to exit, Backspace, ASCII chars
 *     into a buffer; live-filtering via a consumer-provided predicate
 *   - key-binding dispatch: consumer registers handlers per key (n/e/v/d/x/etc.)
 *     that receive the currently selected entity
 *   - refresh() that re-reads entities and re-applies the filter
 *
 * Subclass and implement `render(width)` for the visual presentation —
 * the bulk of an entity TUI's bespoke code. The state machine is
 * generic; the rendering is not. */

import type { PiTuiComponent } from "./pi-types.ts";

export interface EntityListTuiOptions<E> {
  /** Entity source. Re-called by `refresh()`. */
  getEntities: () => E[];

  /** Optional filter predicate. When absent, `/` search is disabled. */
  searchPredicate?: (entity: E, query: string) => boolean;

  /** Default action on Enter — usually "switch" or "select". */
  onSelect?: (entity: E) => void;

  /** Action on Escape / Ctrl-C — typically closes the TUI. */
  onClose?: () => void;

  /** Custom single-key bindings active in list mode. The handler receives
   *  the currently-selected entity (or undefined when the list is empty).
   *  Keys are matched via the supplied `kb.matchesKey`. */
  bindings?: Record<string, (selected: E | undefined) => void>;

  /** Key-handling helpers. Same shape as for SettingsTuiComponent. */
  kb: { matchesKey: (data: string, key: string) => boolean; parseKey: (data: string) => string | undefined };
}

/** Concrete TUI components extend this and implement `render`. The base
 *  manages selection / mode / search state and dispatches input. */
export abstract class EntityListTuiBase<E> implements PiTuiComponent {
  private _entities: E[];
  private _filtered: E[];
  private _selectedIdx = 0;
  private _searchBuffer = "";
  private _mode: "list" | "search" = "list";

  // -------------------------------------------------------------------------
  // Custom-mode state (subclass multi-mode support)
  // -------------------------------------------------------------------------

  /** Current custom mode name. "list" is the default (no custom mode active). */
  protected _customMode = "list";
  /** Arbitrary state associated with the current custom mode. */
  protected _modeState: unknown = undefined;

  constructor(protected readonly opts: EntityListTuiOptions<E>) {
    this._entities = opts.getEntities();
    this._filtered = this._entities;
  }

  // -------------------------------------------------------------------------
  // Read-only state for subclass renders
  // -------------------------------------------------------------------------

  protected get entities(): readonly E[] {
    return this._entities;
  }

  protected get filtered(): readonly E[] {
    return this._filtered;
  }

  protected get selectedIdx(): number {
    return this._selectedIdx;
  }

  protected get selected(): E | undefined {
    return this._filtered[this._selectedIdx];
  }

  protected get mode(): "list" | "search" {
    return this._mode;
  }

  protected get searchBuffer(): string {
    return this._searchBuffer;
  }

  protected get isSearchActive(): boolean {
    return this._mode === "search" || this._searchBuffer.length > 0;
  }

  // -------------------------------------------------------------------------
  // Custom-mode API (subclass multi-mode support)
  // -------------------------------------------------------------------------

  /** Read the current custom mode. "list" means no custom mode is active. */
  currentMode(): string {
    return this._customMode;
  }

  /** Switch to a custom mode with optional associated state. Subclasses
   *  must implement `renderMode` and `handleModeInput` for any mode other
   *  than "list". Pass modeName="list" to return to normal list rendering. */
  switchMode(modeName: string, state?: unknown): void {
    this._customMode = modeName;
    this._modeState = state;
  }

  /** Subclass hook: handle input when a custom mode is active (i.e.
   *  `currentMode() !== "list"`). Return true to claim the event; false to
   *  fall through to the standard list-mode handling.
   *
   *  Default behavior: Esc/Enter switch back to "list"; all other input is
   *  claimed (no scrolling, no list keys leak through). This matches the
   *  prevailing pattern across pi-* entity-list TUIs ("read-only expanded
   *  view, dismiss with Esc/Enter"). Subclasses with scrollable or
   *  interactive custom modes should override. */
  protected handleModeInput(_mode: string, data: string, _state: unknown): boolean {
    const { kb } = this.opts;
    if (kb.matchesKey(data, "escape") || kb.matchesKey(data, "enter")) {
      this.switchMode("list");
    }
    return true;
  }

  /** Subclass hook: render a custom mode. Called by `render` dispatch when
   *  `currentMode() !== "list"`. Subclasses MUST override this when they call
   *  `switchMode` with any name other than "list". Default: throws. */
  protected renderMode(_mode: string, _width: number, _state: unknown): string[] {
    throw new Error(`EntityListTuiBase: subclass must override renderMode for mode "${_mode}"`);
  }

  // -------------------------------------------------------------------------
  // Mutators
  // -------------------------------------------------------------------------

  /** Re-read entities from `getEntities` and re-apply the filter. Call
   *  after operations that mutate the underlying source (delete, create). */
  refresh(): void {
    this._entities = this.opts.getEntities();
    this.applyFilter();
  }

  protected setSelectedIdx(idx: number): void {
    if (this._filtered.length === 0) {
      this._selectedIdx = 0;
      return;
    }
    this._selectedIdx = ((idx % this._filtered.length) + this._filtered.length) % this._filtered.length;
  }

  // -------------------------------------------------------------------------
  // PiTuiComponent contract
  // -------------------------------------------------------------------------

  invalidate(): void {
    // no cache; subclasses can override if they hold cached layout
  }

  /** Subclass owns presentation. The base provides state via the protected
   *  accessors (selected, filtered, mode, searchBuffer, etc.). */
  abstract render(width: number): string[];

  handleInput(data: string): void {
    const { kb } = this.opts;

    // Custom mode: route to subclass handler first; fall through to list
    // handling if not claimed (allows Esc etc. to be intercepted).
    if (this._customMode !== "list") {
      if (this.handleModeInput(this._customMode, data, this._modeState)) return;
    }

    // Search mode: capture chars
    if (this._mode === "search") {
      if (kb.matchesKey(data, "escape")) {
        this._mode = "list";
        this._searchBuffer = "";
        this.applyFilter();
        return;
      }
      if (kb.matchesKey(data, "enter")) {
        this._mode = "list";
        return;
      }
      if (kb.matchesKey(data, "backspace")) {
        this._searchBuffer = this._searchBuffer.slice(0, -1);
        this.applyFilter();
        return;
      }
      const ch = kb.parseKey(data);
      if (ch && ch.length === 1 && ch >= " " && ch <= "~") {
        this._searchBuffer += ch;
        this.applyFilter();
      }
      return;
    }

    // List mode: subclass extension hook fires first
    if (this.handleListInputExtension(data)) return;

    // Standard list-mode keys
    if (kb.matchesKey(data, "escape") || kb.matchesKey(data, "ctrl+c")) {
      this.opts.onClose?.();
      return;
    }
    if (this.opts.searchPredicate && kb.matchesKey(data, "/")) {
      this._mode = "search";
      this._searchBuffer = "";
      return;
    }
    if (kb.matchesKey(data, "up")) {
      this.setSelectedIdx(this._selectedIdx - 1);
      return;
    }
    if (kb.matchesKey(data, "down")) {
      this.setSelectedIdx(this._selectedIdx + 1);
      return;
    }
    if (kb.matchesKey(data, "enter")) {
      const sel = this.selected;
      if (sel && this.opts.onSelect) this.opts.onSelect(sel);
      return;
    }

    // Custom bindings
    if (this.opts.bindings) {
      for (const [key, handler] of Object.entries(this.opts.bindings)) {
        if (kb.matchesKey(data, key)) {
          handler(this.selected);
          return;
        }
      }
    }
  }

  /** Subclass hook for additional list-mode input (mode switches, etc.).
   *  Return true to claim the event; false to fall through to base
   *  handling. Default: no-op returns false. */
  protected handleListInputExtension(_data: string): boolean {
    return false;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private applyFilter(): void {
    const q = this._searchBuffer.toLowerCase();
    if (!q || !this.opts.searchPredicate) {
      this._filtered = this._entities;
    } else {
      const pred = this.opts.searchPredicate;
      this._filtered = this._entities.filter((e) => pred(e, q));
    }
    if (this._selectedIdx >= this._filtered.length) this._selectedIdx = 0;
  }
}
