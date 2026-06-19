# @gonk/extension-spec

Declarative extension definition — slash commands, settings, presets, and tools as pure data. Host-agnostic.

## Shape

```ts
interface ExtensionSpec {
  id: string;
  description: string;
  tools?: ToolDefinition[];
  command?: SlashCommandSpec;   // single slash command with subcommands
  settings?: SettingsSpec;      // drives set subcommand + TUI
  presets?: PresetsSpec;        // drives preset subcommand
  hooks?: Record<string, HookHandler>;
}
```

The spec is data. A runtime (e.g. `@gonk/extension-spec-pi`) consumes it and wires everything up.

## Slash commands

A spec declares one command with named subcommands. The runtime auto-injects `set`, `preset`, and `config` subcommands when the corresponding spec sections are present. User-defined verbs in `subcommands` override or extend those.

`noArgs` controls what happens when the command is invoked bare: `"tui"` (default), `"status"`, `"help"`, or a custom handler function.

## Settings

```ts
interface SettingsSpec {
  scopeKeyPrefix: string;   // prepended by the set subcommand
  sections: SettingsSection[];
  defaultSetTier?: ScopeName;
}
```

Each item has a `type` discriminant (`string | number | boolean | enum | text | model | provider | voice | custom`) that drives both TUI rendering and `set` parsing.

## keyedBy — the indirection primitive

A setting item can declare `keyedBy` to store its value in a `Record` keyed by another setting's resolved value:

```ts
{
  key: "voice.tts.voice-by-model",
  label: "Voice",
  type: { kind: "voice" },
  keyedBy: {
    source: "voice.tts.model",   // index into the map
    mapKey: "voice.tts.voice-by-model",
  },
}
```

Read: `scope.get(mapKey)?.[scope.get(source)]`. Write: merges `{ [sourceValue]: newValue }` into the map. The TUI renders a `[for: <sourceValue>]` hint. Without `keyedBy`, the value lives at `key` directly.

## Presets

`PresetsSpec` lists fields (scope key → preset field name). The auto-generated `preset save/apply/list/delete` subcommands snapshot and restore those keys at configurable tiers.

## Conditional verbs

`SubcommandSpec` accepts an optional `requires?: () => boolean` predicate:

```ts
{
  name: "listen",
  requires: () => Boolean(scope.get("voice.stt.providers")),
  handler: async (ctx) => { /* ... */ },
}
```

Filtered at handler-build time by `buildCommandHandler` (used by both
`@gonk/extension-spec-pi` and `@gonk/extension-spec-cli`). Verbs whose predicate returns
`false` are dropped from the verb table — they are not routed, not shown in help, and not
passed to the TUI. Use this to hide subcommands that depend on optional configuration (e.g.,
mic capture requires a configured STT provider).

## Entry points

```ts
import type { ExtensionSpec, SettingsItem, KeyedByConfig } from "@gonk/extension-spec";
import type { SlashCommandSpec, SubcommandContext } from "@gonk/extension-spec/types";
```

The package is types-only at runtime — no side effects, no I/O.
