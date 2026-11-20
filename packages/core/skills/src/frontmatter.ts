import { isMap, isScalar, parseDocument, stringify, type Pair } from "yaml";

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

/** A new value for one top-level frontmatter key; `undefined` removes it. */
export type FrontmatterChange = string | number | boolean | undefined;

/** Older manifests may spell these keys in camelCase. Writing the snake_case
 *  key replaces the alias where it stands instead of adding a second key. */
const KEY_ALIASES: Readonly<Record<string, string>> = {
  agent_created: "agentCreated",
  created_at: "createdAt",
  last_used_at: "lastUsedAt",
  needs_audit: "needsAudit",
  updated_at: "updatedAt",
  use_count: "useCount",
};

/**
 * Change the named top-level frontmatter keys and leave every other byte of
 * the manifest as it was: unknown keys, their order, comments, scalar styles
 * and line wrapping. A changed key keeps its position; a new key goes at the
 * end of the frontmatter. `body`, when given, replaces everything after the
 * closing `---`.
 */
export function rewriteSkillManifest(
  text: string,
  changes: Readonly<Record<string, FrontmatterChange>>,
  body?: string
): string {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  if (lines[0] !== "---") {
    throw new TypeError("SKILL.md must start with YAML frontmatter");
  }
  const closing = lines.findIndex((line, index) => index > 0 && line === "---");
  if (closing < 0) throw new TypeError("SKILL.md frontmatter is not terminated");
  const source = lines.slice(1, closing);
  const document = parseDocument(source.join("\n"), {
    prettyErrors: false,
    strict: true,
    uniqueKeys: true,
  });
  if (document.errors.length > 0) {
    throw new TypeError("SKILL.md frontmatter is malformed or unsupported");
  }
  const map = document.contents;
  if (!isMap(map) || map.flow === true) {
    throw new TypeError("SKILL.md frontmatter must be a block mapping");
  }

  // Each top-level entry as a line span. Comment lines directly above a key
  // stay with that key, so a rewritten or removed entry leaves them in place.
  const offsets = lineOffsets(source);
  const starts = map.items.map((pair) => lineOf(offsets, keyOffset(pair)));
  const entries = map.items.map((pair, index) => {
    let end = index + 1 < starts.length ? starts[index + 1]! : source.length;
    while (end > starts[index]! + 1 && /^\s*(#.*)?$/.test(source[end - 1]!)) end -= 1;
    return { key: keyName(pair), start: starts[index]!, end };
  });

  const replacements = new Map<number, string[]>();
  const appended: string[] = [];
  for (const [key, value] of Object.entries(changes)) {
    const alias = KEY_ALIASES[key];
    const own = entries.find((entry) => entry.key === key);
    const aliased = alias === undefined ? undefined : entries.find((entry) => entry.key === alias);
    const rendered = value === undefined ? [] : renderEntry(key, value);
    const target = own ?? aliased;
    if (target) replacements.set(target.start, rendered);
    else if (value !== undefined) appended.push(...rendered);
    if (own && aliased) replacements.set(aliased.start, []);
  }

  const out: string[] = [];
  let cursor = 0;
  for (const entry of entries) {
    const replacement = replacements.get(entry.start);
    if (replacement === undefined) continue;
    out.push(...source.slice(cursor, entry.start), ...replacement);
    cursor = entry.end;
  }
  out.push(...source.slice(cursor), ...appended);
  const rest = body ?? lines.slice(closing + 1).join("\n");
  return ["---", ...out, "---", rest].join("\n").replaceAll("\n", newline);
}

function renderEntry(key: string, value: string | number | boolean): string[] {
  return stringify({ [key]: value }).replace(/\n$/, "").split("\n");
}

function keyOffset(pair: Pair): number {
  const range = isScalar(pair.key) ? pair.key.range : undefined;
  if (!range) throw new TypeError("SKILL.md frontmatter keys must be plain scalars");
  return range[0];
}

function keyName(pair: Pair): string {
  if (!isScalar(pair.key) || typeof pair.key.value !== "string") {
    throw new TypeError("SKILL.md frontmatter keys must be strings");
  }
  return pair.key.value;
}

function lineOffsets(lines: readonly string[]): number[] {
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  return offsets;
}

function lineOf(offsets: readonly number[], offset: number): number {
  let line = 0;
  while (line + 1 < offsets.length && offsets[line + 1]! <= offset) line += 1;
  return line;
}
