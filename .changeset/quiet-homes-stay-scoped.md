---
"@gonk/scope": patch
---

Preserve each tier's resolved operational-state home even when document and root resolution deduplicates colliding tier paths. Explicit home overrides now remain authoritative when `cwd`, project, and global homes are the same directory.
