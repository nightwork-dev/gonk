# Legacy registry goldens

`legacy-registry-wrapped.SKILL.md` was generated on 2026-07-16 by importing the
built `SkillRegistry` from
`gonk-extensions/packages/capabilities/skill-creator/dist/registry.js`, calling
`create()` at project scope with the fields represented in the fixture, and
copying the resulting manifest bytes unchanged.

The wrapped `description` is intentional. It locks compatibility with the
legacy registry's actual `yaml.stringify` output rather than a hand-authored
approximation of its frontmatter vocabulary.
