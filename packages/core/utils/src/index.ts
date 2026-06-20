// Node convenience barrel. Prefer the explicit subpaths in real code:
//   - `@gonk/utils/path`  pure, browser-safe path containment
//   - `@gonk/utils/fs`    Node-only atomic writes (pulls in node:fs)
// A browser/edge consumer must import `@gonk/utils/path` directly — this barrel
// re-exports `./fs` and is therefore Node-only.
export * from "./path.ts";
export * from "./fs.ts";
