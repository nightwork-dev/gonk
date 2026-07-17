type Scalar = string | number | boolean | null;
type FrontmatterValue = Scalar | readonly FrontmatterValue[] | FrontmatterRecord;
export interface FrontmatterRecord {
  readonly [key: string]: FrontmatterValue;
}

export interface ParsedSkillDocument {
  frontmatter: FrontmatterRecord;
  body: string;
}

interface Line {
  indent: number;
  text: string;
}

/**
 * Parse the conservative YAML subset used by managed SKILL.md frontmatter.
 * Maps, scalar sequences, quoted/plain scalars, and inline scalar arrays are
 * supported. Unsupported or malformed YAML fails closed instead of being
 * reinterpreted as skill body.
 */
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
  const yamlLines = lines.slice(1, closing);
  const body = lines.slice(closing + 1).join("\n");
  if (body.trim().length === 0) {
    throw new TypeError("SKILL.md body must be non-empty");
  }
  const parsedLines: Line[] = [];
  for (const raw of yamlLines) {
    if (raw.includes("\t")) {
      throw new TypeError("SKILL.md frontmatter may not contain tabs");
    }
    if (raw.trim().length === 0 || raw.trimStart().startsWith("#")) continue;
    const indent = raw.length - raw.trimStart().length;
    if (indent % 2 !== 0) {
      throw new TypeError("SKILL.md frontmatter indentation must use two spaces");
    }
    parsedLines.push({ indent, text: raw.slice(indent) });
  }
  if (parsedLines.length === 0) {
    throw new TypeError("SKILL.md frontmatter must not be empty");
  }
  const cursor = { index: 0 };
  const value = parseBlock(parsedLines, cursor, 0);
  if (cursor.index !== parsedLines.length || !isRecord(value)) {
    throw new TypeError("SKILL.md frontmatter must be a mapping");
  }
  return { frontmatter: value, body };
}

function parseBlock(
  lines: readonly Line[],
  cursor: { index: number },
  indent: number
): FrontmatterValue {
  const first = lines[cursor.index];
  if (!first || first.indent !== indent) {
    throw new TypeError("Malformed SKILL.md frontmatter indentation");
  }
  return first.text.startsWith("- ")
    ? parseSequence(lines, cursor, indent)
    : parseMapping(lines, cursor, indent);
}

function parseSequence(
  lines: readonly Line[],
  cursor: { index: number },
  indent: number
): readonly FrontmatterValue[] {
  const out: FrontmatterValue[] = [];
  while (cursor.index < lines.length) {
    const line = lines[cursor.index]!;
    if (line.indent < indent) break;
    if (line.indent !== indent || !line.text.startsWith("- ")) {
      throw new TypeError("Malformed SKILL.md frontmatter sequence");
    }
    const rest = line.text.slice(2).trim();
    if (rest.length === 0) {
      throw new TypeError("Nested sequence entries must be explicit scalars");
    }
    out.push(parseScalar(rest));
    cursor.index += 1;
  }
  return out;
}

function parseMapping(
  lines: readonly Line[],
  cursor: { index: number },
  indent: number
): FrontmatterRecord {
  const out: Record<string, FrontmatterValue> = {};
  while (cursor.index < lines.length) {
    const line = lines[cursor.index]!;
    if (line.indent < indent) break;
    if (line.indent !== indent || line.text.startsWith("- ")) {
      throw new TypeError("Malformed SKILL.md frontmatter mapping");
    }
    const match = /^([A-Za-z][A-Za-z0-9_-]*):(?:\s*(.*))?$/.exec(line.text);
    if (!match) throw new TypeError("Malformed SKILL.md frontmatter field");
    const key = match[1]!;
    if (Object.hasOwn(out, key)) {
      throw new TypeError(`Duplicate SKILL.md frontmatter field: ${key}`);
    }
    const rest = match[2] ?? "";
    cursor.index += 1;
    if (rest.length > 0) {
      out[key] = parseScalar(rest);
      continue;
    }
    const next = lines[cursor.index];
    if (!next || next.indent <= indent) {
      out[key] = null;
      continue;
    }
    if (next.indent !== indent + 2) {
      throw new TypeError("Malformed SKILL.md frontmatter nesting");
    }
    out[key] = parseBlock(lines, cursor, indent + 2);
  }
  return out;
}

function parseScalar(raw: string): FrontmatterValue {
  const value = stripPlainComment(raw.trim());
  if (value.startsWith("[") || value.endsWith("]")) {
    if (!(value.startsWith("[") && value.endsWith("]"))) {
      throw new TypeError("Malformed inline frontmatter sequence");
    }
    const inner = value.slice(1, -1).trim();
    if (inner.length === 0) return [];
    return splitInline(inner).map(parseScalar);
  }
  if (value.startsWith('"') || value.endsWith('"')) {
    if (!(value.startsWith('"') && value.endsWith('"'))) {
      throw new TypeError("Malformed quoted frontmatter scalar");
    }
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed !== "string") throw new TypeError();
      return parsed;
    } catch {
      throw new TypeError("Malformed quoted frontmatter scalar");
    }
  }
  if (value.startsWith("'") || value.endsWith("'")) {
    if (!(value.startsWith("'") && value.endsWith("'"))) {
      throw new TypeError("Malformed quoted frontmatter scalar");
    }
    return value.slice(1, -1).replaceAll("''", "'");
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return null;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return Number(value);
  if (value.length === 0 || /^[|>{}\[\]&*!]/.test(value)) {
    throw new TypeError("Unsupported SKILL.md frontmatter scalar");
  }
  return value;
}

function splitInline(value: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (const char of value) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (quote === '"' && char === "\\") {
      current += char;
      escaped = true;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = quote === char ? null : quote ?? char;
      current += char;
      continue;
    }
    if (char === "," && quote === null) {
      if (current.trim().length === 0) throw new TypeError("Empty array item");
      out.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (quote !== null || current.trim().length === 0) {
    throw new TypeError("Malformed inline frontmatter sequence");
  }
  out.push(current.trim());
  return out;
}

function stripPlainComment(value: string): string {
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    if (char === "'" || char === '"') {
      quote = quote === char ? null : quote ?? char;
      continue;
    }
    if (char === "#" && quote === null && index > 0 && /\s/.test(value[index - 1]!)) {
      return value.slice(0, index).trimEnd();
    }
  }
  return value;
}

function isRecord(value: FrontmatterValue): value is FrontmatterRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
