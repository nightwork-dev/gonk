import type { ScopeStore } from "@gonk/scope";
import type { ExtensionSpec, SubcommandContext } from "@gonk/extension-spec";
import { ToolRegistry } from "@gonk/tool-registry";
import {
  recordGonkExtension,
  registerGonkTools,
} from "@gonk/tool-registry-pi";

import { buildCommandHandler } from "./command.ts";
import type {
  PiExtensionAPI,
  PiExtensionContext,
  PiHookHandler,
  PiTheme,
  PiTuiComponent,
} from "./pi-types.ts";
import { SettingsTuiComponent, type SettingsTuiAction } from "./settings-tui.ts";

/** Pi-extended SubcommandContext. User-defined verb handlers can declare
 *  this as their `ctx` parameter type to access Pi's `ExtensionContext`
 *  (`ctx.host.piCtx`) and `ExtensionAPI` (`ctx.host.pi`). */
export interface PiSubcommandContext extends SubcommandContext {
  host: {
    pi: PiExtensionAPI;
    piCtx: PiExtensionContext;
  };
}

export interface RegisterSpecOptions {
  /** The Pi runtime's ExtensionAPI. */
  pi: PiExtensionAPI;
  /** Bound scope store. Tools, slash command, and TUI all read/write through this. */
  scope: ScopeStore;
  /** Spec to materialize. */
  spec: ExtensionSpec;
  /** npm package name (e.g. "@gonk/pi-introspect"). When supplied, gets
   *  recorded in the process-wide gonk extension registry so introspection
   *  tools (`harness_status`) can answer "which extensions are loaded?"
   *  without dynamic-import probing — which is fragile across cwd /
   *  node_modules tree boundaries. Optional for backward compatibility. */
  packageName?: string;
  /** TUI dependencies, supplied by the consuming Pi extension package
   *  (which has the actual `@earendil-works/pi-tui` runtime dep). The runtime
   *  is intentionally agnostic to which TUI helpers exist; the consumer
   *  passes them in. */
  tui?: TuiDeps;
  /** Optional override for how user-edit flows render — model picker, voice
   *  picker, text input, etc. The default implementation calls
   *  `piCtx.ui.input` / `piCtx.ui.editor` / `piCtx.ui.select` and resolves
   *  the picker domains via the supplied callback (or skips if absent). */
  editFlow?: EditFlowHandler;
}

export interface TuiDeps {
  matchesKey: (data: string, key: string) => boolean;
  parseKey: (data: string) => string | undefined;
  truncateToWidth: (text: string, width: number, ellipsis?: string, pad?: boolean) => string;
}

/** Handler called by the runtime when the settings TUI emits an `edit`
 *  action that isn't a simple cycle (model/provider/voice pickers,
 *  free-text editor, custom). The runtime supplies the action + a fresh
 *  Pi context + a `next` callback that runs the framework's default flow.
 *
 *  Composition pattern:
 *    editFlow: async (action, ctx, next) => {
 *      if (action.item.type.kind === "model") { ...custom...; return; }
 *      if (action.item.type.kind === "provider") { ...custom...; return; }
 *      await next();  // delegate everything else to the default
 *    }
 *
 *  Consumers that don't call `next()` fully replace the default for the
 *  kinds they handle; consumers that always call `next()` purely augment
 *  it with side effects. */
export type EditFlowHandler = (
  action: Extract<SettingsTuiAction, { kind: "edit" }>,
  ctx: PiSubcommandContext,
  next: () => Promise<void>,
) => Promise<void> | void;

/** Materialize an ExtensionSpec into a registered Pi extension. Wires:
 *    - tools → `pi.registerTool` via `@gonk/tool-registry-pi`
 *    - slash command → `pi.registerCommand` with auto-injected
 *      set/preset/config subcommands
 *    - hooks → `pi.on(event, handler)` for each entry in `spec.hooks`
 *
 *  Returns a teardown function the host can call to clean up. (Pi doesn't
 *  currently expose unregister APIs, so the function is a no-op today —
 *  reserved for future symmetry.) */
export function registerSpecExtension(opts: RegisterSpecOptions): () => void {
  const { pi, scope, spec, tui, editFlow, packageName } = opts;

  // Record this extension's load in the process-wide gonk registry. This
  // is what `harness_status` reads to answer "which extensions are loaded
  // right now?" — replacing dynamic-import probing, which fails when the
  // caller's cwd resolves @gonk/* against a node_modules tree that
  // doesn't contain the package Pi actually loaded.
  recordGonkExtension({
    specId: spec.id,
    ...(packageName !== undefined ? { packageName } : {}),
    ...(spec.readiness !== undefined ? { readiness: spec.readiness } : {}),
  });

  // 1. Tools
  if (spec.tools && spec.tools.length > 0) {
    const registry = new ToolRegistry();
    registry.register(spec.tools);
    registerGonkTools({ pi, source: registry, scope });
  }

  // 2. Slash command
  if (spec.command) {
    const handler = buildCommandHandler(spec, {
      openTui: async (ctx) => {
        if (!spec.settings) return;
        if (!tui) {
          ctx.notify(
            "Settings TUI requested but the runtime was created without `tui` deps. Pass { matchesKey, parseKey, truncateToWidth } from @earendil-works/pi-tui.",
            "error",
          );
          return;
        }
        await openSettingsTuiLoop(ctx as PiSubcommandContext, spec, tui, editFlow);
      },
    });
    pi.registerCommand(spec.command.name, {
      description: spec.command.description,
      handler: async (rawArgs, piCtx) => {
        const subCtx = makePiSubcommandContext(scope, pi, piCtx);
        await handler(rawArgs, subCtx);
      },
    });
  }

  // 3. Hooks
  //
  // Spec hooks use gonk's portable event vocabulary; each host adapter maps
  // them to native events (extension-spec-claude maps `turn_complete` →
  // `Stop`, extension-spec-cli no-ops it). Pi's turn-boundary event is
  // `turn_end` — pi never emits `turn_complete`, so passing the spec key
  // through verbatim would register a hook that never fires.
  if (spec.hooks) {
    for (const [event, handler] of Object.entries(spec.hooks)) {
      const piHandler: PiHookHandler = async (ev, piCtx) => {
        await handler(ev, piCtx);
      };
      pi.on(event === "turn_complete" ? "turn_end" : event, piHandler);
    }
  }

  return () => {
    // Reserved for future symmetric teardown.
  };
}

/** Build the per-invocation SubcommandContext from Pi's runtime. */
function makePiSubcommandContext(
  scope: ScopeStore,
  pi: PiExtensionAPI,
  piCtx: PiExtensionContext,
): PiSubcommandContext {
  return {
    scope,
    hasUI: piCtx.hasUI,
    notify: (message, level) => piCtx.ui.notify(message, level ?? "info"),
    host: { pi, piCtx },
  };
}

/** Loop opening the settings TUI; re-open after each edit-action so the
 *  user stays in the TUI after a picker/editor closes. Mirrors the
 *  ImageConfig / VoiceConfig loops the originals had. */
async function openSettingsTuiLoop(
  ctx: PiSubcommandContext,
  spec: ExtensionSpec,
  tui: TuiDeps,
  editFlow: EditFlowHandler | undefined,
): Promise<void> {
  if (!spec.settings) return;
  const piCtx = ctx.host.piCtx;
  if (!piCtx.ui.custom) {
    ctx.notify("Pi UI does not support custom components on this host.", "error");
    return;
  }

  while (true) {
    const actionRef: { current: SettingsTuiAction } = { current: { kind: "close" } };
    await piCtx.ui.custom<void>((_tui: unknown, theme: PiTheme, _kb: unknown, done: (v?: void) => void): PiTuiComponent => {
      return new SettingsTuiComponent({
        scope: ctx.scope,
        spec: spec.settings!,
        theme,
        kb: { matchesKey: tui.matchesKey, parseKey: tui.parseKey },
        truncate: tui.truncateToWidth,
        onAction: (a) => {
          actionRef.current = a;
          done();
        },
      });
    });
    const action = actionRef.current;
    if (action.kind === "close") return;
    if (action.kind === "edit") {
      const runDefault = () => defaultEditFlow(action, ctx);
      if (editFlow) {
        await editFlow(action, ctx, runDefault);
      } else {
        await runDefault();
      }
      continue;
    }
  }
}

/** Default edit flow: free-text via input/editor, fall back to notify for
 *  picker types the consumer didn't override. Consumer extensions
 *  (pi-image, pi-voice) supply richer flows via `editFlow` for model /
 *  provider / voice pickers, then call `next()` to delegate the rest.
 *
 *  Exported so consumers can call it explicitly inside their own editFlow,
 *  or use the `next()` parameter the runtime passes — both invoke this. */
export async function defaultEditFlow(
  action: Extract<SettingsTuiAction, { kind: "edit" }>,
  ctx: PiSubcommandContext,
): Promise<void> {
  const piCtx = ctx.host.piCtx;
  const { item, tier } = action;

  if (item.type.kind === "text" && piCtx.ui.editor) {
    const current = ctx.scope.get<string>(item.key) ?? "";
    const next = await piCtx.ui.editor(`${item.label} (@ ${tier})`, current);
    if (next === undefined) return;
    const trimmed = next.trim();
    try {
      if (trimmed.length === 0) ctx.scope.delete(item.key, tier);
      else ctx.scope.set(item.key, trimmed, tier);
      ctx.notify(`${item.label} updated @ ${tier}`, "info");
    } catch (err) {
      ctx.notify(err instanceof Error ? err.message : String(err), "error");
    }
    return;
  }

  if (item.type.kind === "custom") {
    const current = ctx.scope.get<unknown>(item.key);
    const next = await item.type.pick(ctx, current, tier);
    if (next === undefined) return;
    try {
      ctx.scope.set(item.key, next, tier);
      ctx.notify(`${item.label} set @ ${tier}`, "info");
    } catch (err) {
      ctx.notify(err instanceof Error ? err.message : String(err), "error");
    }
    return;
  }

  if (
    item.type.kind === "model" ||
    item.type.kind === "provider" ||
    item.type.kind === "voice"
  ) {
    ctx.notify(
      `Picker for type '${item.type.kind}' not wired. Pass an editFlow to registerSpecExtension that handles this kind.`,
      "error",
    );
    return;
  }

  // string / number — generic input prompt
  if (!piCtx.ui.input) {
    ctx.notify("Pi UI lacks an input prompt; cannot edit this setting.", "error");
    return;
  }
  const current = ctx.scope.get<unknown>(item.key);
  const placeholder = current !== undefined ? String(current) : String(item.default ?? "");
  const raw = await piCtx.ui.input(`${item.label} (@ ${tier})`, placeholder);
  if (raw === undefined) return;
  const trimmed = raw.trim();
  if (!trimmed) {
    ctx.scope.delete(item.key, tier);
    ctx.notify(`${item.label} cleared @ ${tier}`, "info");
    return;
  }
  let value: unknown = trimmed;
  if (item.type.kind === "number") {
    const n = Number.parseFloat(trimmed);
    if (Number.isNaN(n)) {
      ctx.notify(`Not a number: ${trimmed}`, "error");
      return;
    }
    value = n;
  }
  try {
    ctx.scope.set(item.key, value, tier);
    ctx.notify(`${item.label} = ${JSON.stringify(value)} @ ${tier}`, "info");
  } catch (err) {
    ctx.notify(err instanceof Error ? err.message : String(err), "error");
  }
}
