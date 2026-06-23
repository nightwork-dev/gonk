# @gonk/utils

Zero-dependency utility primitives shared across the gonk foundation and the
extension ecosystem. Code-split per concern **and per platform**, so a consumer
imports exactly the silo it needs.

**Import the subpath, not the barrel.** Extensions run as unbundled Node ESM,
where tree-shaking does not apply: a named subpath import only evaluates the file
it points at. The split is also a platform boundary — see below.

## `@gonk/utils/path` — pure, browser-safe

Path-containment logic with **no `node:*` in its import graph** (no `node:fs`,
no `node:path`, no `process`). It bundles for a browser/edge target as-is, no
shim or aliasing. POSIX-oriented: both `/` and `\` are treated as separators and
results join with `/`.

```ts
import { safeJoin, safeKeyPath } from "@gonk/utils/path";
```

| Export | Purpose |
| --- | --- |
| `safeJoin(root, rel)` | Resolve `rel` under `root`; throw if it escapes (via `..`, an absolute segment). Internal `..` that stays inside is normalized. |
| `safeKeyPath(root, subDir, key)` | Stricter variant for stable storage keys: rejects absolute/`..` keys outright so a key round-trips to exactly the path it names. |

## `@gonk/utils/fs` — Node-only

Atomic writes (temp-file + rename). Uses `node:fs` and `process`, so this entry
is fundamentally non-browser; it is kept apart from `./path` precisely so a
browser bundle importing `@gonk/utils/path` can never transitively reach
`node:fs`.

```ts
import { atomicWriteText, atomicWriteBytes, atomicWriteJson } from "@gonk/utils/fs";
```

| Export | Purpose |
| --- | --- |
| `atomicWriteText(path, text)` | Atomic UTF-8 text write. A reader never sees a torn file. |
| `atomicWriteBytes(path, bytes)` | Atomic raw-bytes write. |
| `atomicWriteJson(path, value)` | Atomic pretty-JSON write with a trailing newline. |

> The default barrel (`@gonk/utils`) re-exports both and is therefore Node-only.
> Browser/edge code must import `@gonk/utils/path` directly.
