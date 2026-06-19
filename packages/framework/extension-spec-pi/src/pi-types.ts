/**
 * Structural Pi types — declared in-place so the package has no hard dep on
 * `@earendil-works/pi-coding-agent` or `pi-ext-kit`. The user's real `ExtensionAPI`
 * matches structurally at consumer call sites, same approach as
 * `@gonk/tool-registry-pi`.
 */

import type { PiToolSpec } from "@gonk/tool-registry-pi";

export type NotifyLevel = "info" | "error" | "warn";

/** Minimum surface of Pi's `ExtensionAPI` the runtime calls. The real
 *  ExtensionAPI has many more methods; we type only what we use. */
export interface PiExtensionAPI {
  registerTool(spec: PiToolSpec): unknown;
  registerCommand(name: string, options: PiCommandOptions): unknown;
  /** Register a hook. Handlers may return void OR a result object — the
   *  result-returning hooks (`before_agent_start` → `PiBeforeAgentStartResult`,
   *  `before_provider_request`, `input`, …) chain their return; the runtime
   *  ignores returns from void hooks. The `event` payload is opaque (`unknown`)
   *  here; a handler narrows it with a typed assertion (e.g.
   *  `event as PiBeforeAgentStartEvent`), the idiom used across the plugins. */
  on(event: string, handler: PiHookHandler): unknown;
  sendUserMessage?(text: string): void;
  /** Dynamic tool-set control. These live on the ExtensionAPI (the `pi`
   *  object passed to setup), NOT on the per-event ctx — `bindCore` wires them
   *  in the shared session-construction path, so they work in every mode
   *  (interactive, rpc, print) once bound. Call post-bind (e.g. from a hook or
   *  tool handler), never during setup. Optional: a host may not provide them. */
  getActiveTools?(): string[];
  getAllTools?(): { name: string }[];
  setActiveTools?(toolNames: string[]): void;
  refreshTools?(): void;
}

export interface PiCommandOptions {
  description: string;
  handler: (rawArgs: string, ctx: PiExtensionContext) => Promise<void> | void;
}

export type PiHookHandler = (event: unknown, ctx: PiExtensionContext) => unknown | Promise<unknown>;

/** `before_agent_start` event/result (pi's `BeforeAgentStartEvent` /
 *  `BeforeAgentStartEventResult`): the assembled system prompt + the user's
 *  prompt in, a replacement systemPrompt out. */
export interface PiBeforeAgentStartEvent {
  systemPrompt: string;
  prompt?: string;
}
export interface PiBeforeAgentStartResult {
  systemPrompt: string;
}

/** Pi's run mode (`ExtensionMode`, pi ≥ 0.78): `tui` (interactive terminal),
 *  `rpc` (interactive IDE/programmatic), `json`/`print` (headless one-shot). */
export type PiExtensionMode = "tui" | "rpc" | "json" | "print";

/** Whether `mode` is an interactive session a user can respond in (`tui`/`rpc`)
 *  vs a headless one-shot (`json`/`print`). Absence — an older pi without
 *  `ctx.mode` — is treated as interactive to preserve prior behavior. Use this
 *  to gate user-facing surfaces (e.g. an elicited question) that are wasted or
 *  misleading when no user is present. */
export function isInteractiveMode(mode: PiExtensionMode | undefined): boolean {
  return mode === undefined || mode === "tui" || mode === "rpc";
}

/** Minimum surface of Pi's `ExtensionContext` the runtime accesses. */
export interface PiExtensionContext {
  hasUI: boolean;
  ui: PiUI;
  /** The session's run mode (pi ≥ 0.78). Optional — older pi builds don't
   *  expose it, so callers feature-detect; treat absence as interactive. */
  mode?: PiExtensionMode;
  /** Effective project-trust decision for the current cwd (pi ≥ 0.78).
   *  Optional: older pi builds don't expose it, so callers must
   *  feature-detect (`typeof ctx.isProjectTrusted === "function"`). */
  isProjectTrusted?(): boolean;
  /** Inspect the base system-prompt inputs pi assembled for this turn (pi's
   *  `getSystemPromptOptions()` → `BuildSystemPromptOptions`, pi ≥ 0.78).
   *  Optional; feature-detect. Opaque here — declared so consumers can read it
   *  without casting `pi`. */
  getSystemPromptOptions?(): unknown;
}

/** Minimum surface of Pi's `ctx.ui` the runtime calls. Most methods are
 *  optional because a non-UI host (running in a script) may not provide them. */
export interface PiUI {
  notify(message: string, level?: NotifyLevel): void;
  setStatus?(slot: string, message: string | undefined): void;
  getEditorText?(): string;
  setEditorText?(text: string): void;
  input?(label: string, placeholder?: string): Promise<string | undefined>;
  editor?(label: string, current: string): Promise<string | undefined>;
  select?(title: string, options: string[]): Promise<string | undefined>;
  /** Render a custom TUI component. The component object follows Pi's
   *  required shape: `invalidate()`, `handleInput(data)`, `render(width)`. */
  custom?<T>(
    factory: (
      tui: unknown,
      theme: PiTheme,
      kb: unknown,
      done: (value?: T) => void,
    ) => PiTuiComponent,
  ): Promise<T | undefined>;
}

/** Pi's `Theme` surface used by TUI rendering. */
export interface PiTheme {
  fg(color: string, text: string): string;
}

/** Pi's required component shape for `ctx.ui.custom(factory)`. */
export interface PiTuiComponent {
  invalidate(): void;
  handleInput(data: string): void;
  render(width: number): string[];
}
