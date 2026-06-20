# @gonk/utils

Zero-dependency utility primitives shared across the gonk foundation and the
extension ecosystem. Pure `node:fs`/`node:path` — no domain coupling — so it
sits at the bottom of the dependency tree and any package can depend on it
without pulling in config or persistence machinery.

**Import the subpath, not the barrel.** Extensions run as unbundled Node ESM,
where tree-shaking does not apply: a named subpath import only evaluates the file
it points at.

```ts
import { safeJoin, atomicWriteJson } from "@gonk/utils/fs";
```

## `@gonk/utils/fs`

Filesystem safety primitives.

| Export | Purpose |
| --- | --- |
| `safeJoin(root, rel)` | Resolve `rel` under `root`; throw if it escapes (via `..`, an absolute segment, …). Use before writing/deleting any path built from untrusted data. |
| `safeKeyPath(root, subDir, key)` | Stricter variant for stable storage keys: rejects absolute/`..`/empty-segment keys outright so a key round-trips to exactly the path it names. |
| `atomicWriteText(path, text)` | Temp-file + rename write of UTF-8 text. A reader never sees a torn file. |
| `atomicWriteBytes(path, bytes)` | Atomic write of raw bytes. |
| `atomicWriteJson(path, value)` | Atomic write of pretty JSON with a trailing newline. |
