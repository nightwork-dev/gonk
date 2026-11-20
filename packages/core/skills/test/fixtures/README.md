# Legacy registry goldens

`legacy-registry-wrapped.SKILL.md` and `legacy-registry-date-only.SKILL.md` were
generated on 2026-07-16 by importing the
built `SkillRegistry` from
`gonk-extensions/packages/capabilities/skill-creator/dist/registry.js`, calling
`create()` at project scope with the fields represented in the fixture, and
copying the resulting manifest bytes unchanged.

The wrapped `description` is intentional. It locks compatibility with the
legacy registry's actual `yaml.stringify` output rather than a hand-authored
approximation of its frontmatter vocabulary.

The date-only fixture locks the legacy provenance contract: `pinnedAt` was
documented as an ISO 8601 date and the registry serialized `2026-07-16` as
`pinned_at` unchanged. Operational metadata timestamps remain instant-only.

`real-tick-simulation-debugging.SKILL.md` is a real global skill copied on
2026-11-20, with its local repository path replaced and the body cut to its
first paragraph. Its `provenance.pinned_at: 2026-07` does not parse as a
date; the registry lists it with a warning and every rewrite keeps the field
as written.
