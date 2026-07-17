import { parseDocument } from "yaml";

type FrontmatterScalar = string | number | boolean | null;
type FrontmatterValue =
  | FrontmatterScalar
  | readonly FrontmatterValue[]
  | FrontmatterRecord;

export interface FrontmatterRecord {
  readonly [key: string]: FrontmatterValue;
}

export interface ParsedSkillDocument {
  frontmatter: FrontmatterRecord;
  body: string;
}

/** Parse the same YAML emitted by the legacy SkillRegistry's yaml.stringify. */
export function parseSkillDocument(text: string): ParsedSkillDocument {
  const normalized = text.replaceAll("\r\n", "\n");
  if (!normalized.startsWith("---\n")) {
    throw new TypeError("SKILL.md must start with YAML frontmatter");
  }
  const lines = normalized.split("\n");
  const closing = lines.findIndex((line, index) => index > 0 && line === "---");
  if (closing < 0) {
    throw new TypeError("SKILL.md frontmatter is not terminated");
  }
  const body = lines.slice(closing + 1).join("\n");
  if (body.trim().length === 0) {
    throw new TypeError("SKILL.md body must be non-empty");
  }

  const document = parseDocument(lines.slice(1, closing).join("\n"), {
    prettyErrors: false,
    strict: true,
    uniqueKeys: true,
  });
  if (document.errors.length > 0 || document.warnings.length > 0) {
    throw new TypeError("SKILL.md frontmatter is malformed or unsupported");
  }
  let value: unknown;
  try {
    value = document.toJS({ maxAliasCount: 0 });
  } catch {
    throw new TypeError("SKILL.md frontmatter contains unsupported aliases");
  }
  if (!isFrontmatterRecord(value) || !isFrontmatterValue(value)) {
    throw new TypeError("SKILL.md frontmatter must be a scalar-only mapping");
  }
  return { frontmatter: value, body };
}

function isFrontmatterValue(value: unknown): value is FrontmatterValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(isFrontmatterValue);
  return (
    isFrontmatterRecord(value) &&
    Object.values(value).every(isFrontmatterValue)
  );
}

function isFrontmatterRecord(value: unknown): value is FrontmatterRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
