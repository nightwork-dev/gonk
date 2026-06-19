# @gonk/tool-registry-cli

CLI adapter — turns a `ToolRegistry` or `Orchestrator` into a binary where each tool is a subcommand.

## Argv shapes

```bash
my-bin <tool-name> [<positional>...] [--<flag> <value>]   # ergonomic
my-bin <tool-name> --input '<json>'                       # arbitrary input
my-bin <tool-name> --json                                 # JSON Lines on stdout
my-bin list                                               # list tools
my-bin <tool-name> --help                                 # tool help
my-bin --version
```

Positional args are mapped via `tool.hints.cli.positional[]`. Other flags become object keys (with simple coercion: `true`/`false`/`null`/numbers).

## Output rendering

- `progress` and `log` events → stderr
- `data` chunks → stdout (one JSON per line)
- `result` → display blocks rendered (markdown/text/code/json/link → text; image → placeholder)
- `error` → stderr, exit code mapped (`INVALID_INPUT`=2, `TOOL_NOT_FOUND`=127, `ABORTED`=130, other=1)

Duplex tools are filtered from `list` and refused at invocation (CLI has no bidirectional input).

## Scope threading

The adapter accepts a `ScopeStore` and threads it into every `ctx.scope`:

```ts
import { createCli } from "@gonk/tool-registry-cli";
import { FsScopeStore } from "@gonk/scope/fs";

const scope = new FsScopeStore({ cwd: process.cwd() });
const cli = createCli({ binaryName: "my-bin", source: registry, scope });
const exitCode = await cli.run(process.argv.slice(2));
```

## SIGINT

Handled automatically — SIGINT aborts the in-flight tool via `ctx.signal`. Pass an external `AbortSignal` via `io.signal` to override.
