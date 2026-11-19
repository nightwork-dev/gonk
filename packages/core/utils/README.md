# @gonk/utils

Small file-safety helpers with no dependencies: path containment and atomic
writes. The other `@gonk/*` packages use them, and you can use them directly.

Each concern has its own subpath, so you load only the file you import. The
split also separates browser-safe code from Node-only code.

## Install

```sh
npm install @gonk/utils
```

## `@gonk/utils/path`: browser-safe path containment

```ts
import { safeJoin, safeKeyPath } from "@gonk/utils/path";

safeJoin("/data", "reports/q1.json");   // → "/data/reports/q1.json"
safeJoin("/data", "../etc/passwd");     // throws: the path leaves the root
safeKeyPath("/data", "kv", "prefs");    // → "/data/kv/prefs"
```

| Export | What it does |
| --- | --- |
| `safeJoin(root, rel)` | Resolves `rel` under `root` and throws if the result leaves `root`. A `..` that stays inside is allowed. |
| `safeKeyPath(root, subDir, key)` | A stricter version for storage keys. It refuses any absolute key or `..`, so a key maps to exactly one path. |

This entry imports no `node:*` modules and does not use `process`, so it
bundles for browsers and edge runtimes as it is. It treats both `/` and `\` as
separators and joins with `/`.

## `@gonk/utils/fs`: atomic writes (Node only)

```ts
import { atomicWriteJson, atomicWriteText, atomicWriteBytes } from "@gonk/utils/fs";

atomicWriteJson("/data/settings.json", { theme: "dark" });
```

| Export | What it does |
| --- | --- |
| `atomicWriteText(path, text)` | Writes UTF-8 text atomically. A reader never sees a partly written file. |
| `atomicWriteBytes(path, bytes)` | Writes raw bytes atomically. |
| `atomicWriteJson(path, value)` | Writes formatted JSON with a trailing newline, atomically. |

Each write goes to a temporary file that is then renamed into place.

## The main entry

`@gonk/utils` re-exports both subpaths, so it is Node only. Browser and edge
code must import `@gonk/utils/path` directly.

## License

Apache-2.0
