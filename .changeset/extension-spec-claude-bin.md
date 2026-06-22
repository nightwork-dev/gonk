---
"@gonk/extension-spec-claude": patch
---

Declare `gonk-claude-hook` as a package `bin` + add the `#!/usr/bin/env node`
shebang to its source. Without this, `npm install @gonk/extension-spec-claude`
never created `node_modules/.bin/gonk-claude-hook`, so a materialized Claude plugin
had no self-contained way to reference the hook runner — forcing a hardcoded
absolute path into the dev monorepo (which broke when the repo moved). With the
bin, any plugin that installs this package from the registry gets the runner in
its own `node_modules/.bin`, referenceable via `${CLAUDE_PLUGIN_ROOT}` — the
foundation for modular, registry-based, self-contained plugin installs.
