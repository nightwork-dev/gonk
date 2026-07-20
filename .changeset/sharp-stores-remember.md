---
"@gonk/store": minor
---

Move `MirkStoreBackend`, `mirkBackendFactory`, and the Mirk SQLite path and
migration helpers from the `@gonk/store` root export to `@gonk/store/sqlite`.
`better-sqlite3` is now an optional peer dependency that hosts install only
when they use the SQLite backend.
