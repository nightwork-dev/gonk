# @gonk/extension-spec-cli

CLI runtime for [`@gonk/extension-spec`](../extension-spec/). Mirror of
[`@gonk/extension-spec-pi`](../extension-spec-pi/) for the CLI host.

## What it does

- Translates `gonk <ext> <verb> ...` argv into the spec framework's rawArgs
  format, then dispatches through the same command handler the Pi runtime
  uses (so framework-injected `set`/`preset`/`config` verbs work identically).
- Auto-generates an interactive `gonk <ext> config` flow from
  `spec.settings` using `@inquirer/prompts`.
- Wires `spec.hooks.session_start` to fire once at process boot,
  `session_end` to fire on process exit / SIGINT.

## Usage

```ts
import { registerSpecExtensionCli } from "@gonk/extension-spec-cli";

export function setupCli(cli, scope) {
  const spec = buildMyExtensionSpec();
  registerSpecExtensionCli({ cli, scope, spec });
}
```

Each `@gonk/pi-*` package exports a `setupCli` of this shape. `@gonk/cli`
discovers installed extensions in `~/.gonk/extensions/` and calls each
one's `setupCli` at startup.

## Test

```bash
pnpm -F @gonk/extension-spec-cli test
```
