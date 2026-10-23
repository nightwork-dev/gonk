---
"@gonk/store": patch
"@gonk/retrieval": patch
"@gonk/skills": patch
"@gonk/temporal": patch
---

Depend on `@mirk/store` 0.13.0. `@gonk/store` accepts better-sqlite3 11, 12 or 13 and no longer passes the removed `forceJsCosine` option; exact cosine is now Mirk's only vector search path.
