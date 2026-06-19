import type {
  ExtensionSpec,
  SubcommandContext,
  SubcommandSpec,
} from "@gonk/extension-spec";

import { parseSubcommandArgs, stripVerb } from "./parse-args.ts";
import { runSetSubcommand, renderSettingsStatus } from "./settings.ts";
import { runPresetSubcommand } from "./presets.ts";

/** Drop subcommands whose `requires()` predicate returns false. Predicate
 *  is sync so this happens at handler-build time; downstream code never
 *  sees the filtered verbs. */
function filterByRequires(
  verbs: Record<string, SubcommandSpec>,
): Record<string, SubcommandSpec> {
  const out: Record<string, SubcommandSpec> = {};
  for (const [name, spec] of Object.entries(verbs)) {
    if (spec.requires && !spec.requires()) continue;
    out[name] = spec;
  }
  return out;
}

/** Builds a Pi-shape command handler from a spec. The returned function
 *  takes Pi's `(rawArgs, piCtx)` and dispatches to the spec's user-defined
 *  subcommands plus the framework-injected `set` / `preset` / `instructions`
 *  / `config` verbs.
 *
 *  Subcommand-name precedence (first match wins):
 *    1. user-defined verbs in `spec.command.subcommands`
 *    2. framework-injected: `set` (if spec.settings), `preset` (if spec.presets)
 *    3. `config` always — opens TUI when host has UI, prints status otherwise
 *
 *  When no verb is given, the framework respects `spec.command.noArgs`:
 *    "tui" (default) — opens the settings TUI when host has UI; falls back
 *                       to status print when not
 *    "status"        — prints the settings status string
 *    "help"          — prints subcommand list
 */
export function buildCommandHandler(
  spec: ExtensionSpec,
  hooks: { openTui: (ctx: SubcommandContext) => Promise<void> | void },
): (rawArgs: string, ctx: SubcommandContext) => Promise<void> {
  const userVerbs = filterByRequires(spec.command?.subcommands ?? {});
  const noArgsMode = spec.command?.noArgs ?? "tui";

  return async function handle(rawArgs, ctx) {
    const parsed = parseSubcommandArgs(rawArgs);
    const verb = parsed.positional[0];

    if (!verb) {
      // No-UI host always falls back to status print regardless of mode.
      if (!ctx.hasUI) {
        if (spec.settings) {
          ctx.notify(renderSettingsStatus(ctx.scope, spec.settings), "info");
        } else {
          ctx.notify(`/${spec.command?.name ?? spec.id} — ${spec.description}`, "info");
        }
        return;
      }
      if (noArgsMode === "status") {
        if (spec.settings) {
          ctx.notify(renderSettingsStatus(ctx.scope, spec.settings), "info");
        } else {
          ctx.notify(`/${spec.command?.name ?? spec.id} — ${spec.description}`, "info");
        }
        return;
      }
      if (noArgsMode === "help") {
        ctx.notify(formatHelp(spec, userVerbs), "info");
        return;
      }
      // Function: custom no-args handler.
      if (typeof noArgsMode === "function") {
        await noArgsMode(ctx);
        return;
      }
      // "tui" (default)
      if (spec.settings) await hooks.openTui(ctx);
      else ctx.notify(`/${spec.command?.name ?? spec.id} — ${spec.description}`, "info");
      return;
    }

    // 1. User-defined verb
    if (verb in userVerbs) {
      const sub = userVerbs[verb]!;
      const inner = parseSubcommandArgs(stripVerb(rawArgs, verb));
      await sub.handler(inner, ctx);
      return;
    }

    // 2. Framework-injected verbs
    if (verb === "set" && spec.settings) {
      const inner = parseSubcommandArgs(stripVerb(rawArgs, "set"));
      runSetSubcommand(inner, ctx, spec.settings);
      return;
    }

    if (verb === "preset" && spec.presets) {
      const inner = parseSubcommandArgs(stripVerb(rawArgs, "preset"));
      await runPresetSubcommand(inner, ctx, spec.presets);
      return;
    }

    if (verb === "config") {
      if (!ctx.hasUI) {
        if (spec.settings) {
          ctx.notify(renderSettingsStatus(ctx.scope, spec.settings), "info");
        } else {
          ctx.notify("No settings declared.", "info");
        }
        return;
      }
      if (spec.settings) await hooks.openTui(ctx);
      else ctx.notify("No settings declared.", "info");
      return;
    }

    // Unknown
    const known = listKnownVerbs(spec, userVerbs);
    ctx.notify(
      `Unknown subcommand: ${verb}. Try: ${known}`,
      "error",
    );
  };
}

function listKnownVerbs(
  spec: ExtensionSpec,
  userVerbs: Record<string, unknown>,
): string {
  const names: string[] = [];
  for (const k of Object.keys(userVerbs)) names.push(k);
  if (spec.settings) names.push("set", "config");
  if (spec.presets) names.push("preset");
  return names.join(", ");
}

function formatHelp(
  spec: ExtensionSpec,
  userVerbs: Record<string, { description: string }>,
): string {
  const lines: string[] = [`/${spec.command?.name ?? spec.id} — ${spec.description}`, ""];
  for (const [verb, sub] of Object.entries(userVerbs)) {
    lines.push(`  ${verb.padEnd(16)}${sub.description}`);
  }
  if (spec.settings) {
    lines.push(`  ${"set".padEnd(16)}Set a setting at a scope tier.`);
    lines.push(`  ${"config".padEnd(16)}Open the settings TUI.`);
  }
  if (spec.presets) {
    lines.push(`  ${"preset".padEnd(16)}list | save <name> | apply <name> | delete <name>`);
  }
  return lines.join("\n");
}
