---
"@gonk/extension-spec-pi": minor
"@gonk/scope": minor
---

Add the host-owned Pi storage runtime and keep generated Pi runtime state from creating project boundaries. A `.agents` or `.gonk` namespace holding only host runtime directories (`gonk`, `pi-state`, `memory-state`, `autotune-claims`, `objective-watch`) no longer marks a project root. `findProjectRoot` takes an optional `ceiling` and `ScopeEnvironment` an optional `projectCeiling`, so a sandbox can stop the project walk at its own root.
