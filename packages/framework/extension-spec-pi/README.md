# @gonk/extension-spec-pi

Pi runtime that materializes an `ExtensionSpec` into a registered Pi extension — tools, slash command, auto-generated settings TUI, and preset management.

## Entry point

```ts
import { registerSpecExtension } from "@gonk/extension-spec-pi";

registerSpecExtension({ pi, scope, spec, tui, editFlow });
```

That single call wires:
- **Tools** — registered via `@gonk/tool-registry-pi`
- **Slash command** — registered with `pi.registerCommand`; auto-injects `set`, `preset`, and `config` subcommands
- **Hooks** — each `spec.hooks` entry bound via `pi.on(event, handler)`

Returns a teardown function (no-op today; reserved for future unregister APIs).

## Auto-generated subcommands

When `spec.settings` is present the runtime injects a `set <key> <value>` subcommand and opens the settings TUI on a bare invocation. When `spec.presets` is present it injects `preset save/apply/list/delete`. The consuming extension only needs to declare the verbs that are genuinely its own.

## Settings TUI

The `SettingsTuiComponent` renders all sections and items from `SettingsSpec`, including `keyedBy` indirection. It emits an `edit` action for items that need a picker or text editor, then closes so the host can open the appropriate UI, then reopens.

The `editFlow` option lets consumers intercept specific item kinds:

```ts
editFlow: async (action, ctx, next) => {
  if (action.item.type.kind === "model") {
    // open your model picker
    return;
  }
  await next(); // delegate everything else to the default
}
```

`defaultEditFlow` is exported for consumers that want to call it explicitly.

## EntityListTuiBase

Abstract base class for entity-list TUIs (used by `@gonk/pi-persona`, `@gonk/pi-skill-creator`, etc.). Provides selection state, bounded nav, live `/`-search overlay, and key-binding dispatch. Subclass and implement `render(width)`.

```ts
class MyListTui extends EntityListTuiBase<MyEntity> {
  render(width: number): string[] { ... }
}
```

### Multi-mode API

`EntityListTuiBase` exposes a lifted multi-mode API so subclasses can have multiple display
modes (e.g. list vs. expanded detail) without separate components:

| Method | Purpose |
|---|---|
| `currentMode()` | Returns the active mode name (`"list"` or a custom name) |
| `switchMode(name, state?)` | Transition to a named mode, optionally carrying state |
| `handleModeInput(mode, data, state)` | Override in subclass to handle key events in non-list modes; return `true` to claim |
| `renderMode(mode, width, state)` | Override in subclass to render non-list modes; default throws |

`PersonaTuiComponent` and `SkillTuiComponent` both use this pattern — `switchMode("expanded", entity)` on Enter, `switchMode("list")` on Escape.

## VerbPickerTuiComponent

Reusable TUI component for `noArgs` command handlers. Displays all available verbs and lets
the user pick one interactively.

Bindings: ↑↓ / j-k navigate, 1-9 quick-select by index, Enter confirms (async arg prompt
opens for verbs with `requiresArg`), q / Esc cancel.

Used by `/voice`, `/image`, `/memory`, and other extensions that want a discovery UI when
invoked bare.

```ts
import { VerbPickerTuiComponent } from "@gonk/extension-spec-pi";
```

## PiSubcommandContext

User-defined verb handlers type their `ctx` as `PiSubcommandContext` to access `ctx.host.pi` (`PiExtensionAPI`) and `ctx.host.piCtx` (`PiExtensionContext`).

## Entry points

```ts
import { registerSpecExtension, defaultEditFlow, EntityListTuiBase } from "@gonk/extension-spec-pi";
import type { EditFlowHandler, PiSubcommandContext, RegisterSpecOptions } from "@gonk/extension-spec-pi";
import { parseSubcommandArgs } from "@gonk/extension-spec-pi/parse-args";
```
