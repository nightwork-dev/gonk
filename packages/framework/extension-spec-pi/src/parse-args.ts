import type { ParsedSubcommandArgs } from "@gonk/extension-spec";

/** Parse a raw subcommand-arg string into positional + flag form.
 *
 *  Input: the string AFTER the verb has been stripped. Example: if the user
 *  types `/voice set bind \\ session`, the framework first identifies `set`
 *  as the verb, then passes `"bind \\ session"` to this parser.
 *
 *  Behavior:
 *    - `--key value` → flags.key = value
 *    - `--key` (no value, or followed by another --) → flags.key = true
 *    - everything else, in order → positional[]
 *    - quotes (single or double) group multi-word positional tokens
 *    - the original raw string is preserved in `raw` for free-text subcommands
 *      that want it (e.g. `/voice instructions <multi-word text>`)
 *
 *  Examples:
 *    parseSubcommandArgs("foo bar")
 *      → { positional: ["foo", "bar"], flags: {}, raw: "foo bar" }
 *    parseSubcommandArgs("--prompt 'a cat' --n 3")
 *      → { positional: [], flags: { prompt: "a cat", n: "3" }, raw: "..." }
 *    parseSubcommandArgs("'hello world' session")
 *      → { positional: ["hello world", "session"], flags: {}, raw: "..." }
 */
export function parseSubcommandArgs(rawArgs: string): ParsedSubcommandArgs {
  const raw = rawArgs;
  const tokens = tokenize(rawArgs);
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (tok.startsWith("--")) {
      const key = tok.slice(2);
      const peek = tokens[i + 1];
      if (peek === undefined || peek.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = peek;
        i++;
      }
    } else {
      positional.push(tok);
    }
  }

  return { positional, flags, raw };
}

/** Tokenize a shell-ish arg string honoring `'...'` and `"..."` grouping.
 *  Backslash-escapes inside quotes are NOT supported — gonk subcommands
 *  don't need shell-fidelity, just sane multi-word handling. */
function tokenize(input: string): string[] {
  const out: string[] = [];
  const trimmed = input.trim();
  if (!trimmed) return out;

  let i = 0;
  while (i < trimmed.length) {
    while (i < trimmed.length && trimmed[i] === " ") i++;
    if (i >= trimmed.length) break;

    const ch = trimmed[i]!;
    if (ch === "'" || ch === '"') {
      const quote = ch;
      i++;
      const start = i;
      while (i < trimmed.length && trimmed[i] !== quote) i++;
      out.push(trimmed.slice(start, i));
      if (i < trimmed.length) i++; // consume closing quote
    } else {
      const start = i;
      while (i < trimmed.length && trimmed[i] !== " ") i++;
      out.push(trimmed.slice(start, i));
    }
  }
  return out;
}

/** Strip a leading verb word from a raw arg string. Used by the framework
 *  before passing the remainder to the verb's handler.
 *
 *  Example: stripVerb("instructions hello world", "instructions") → "hello world" */
export function stripVerb(rawArgs: string, verb: string): string {
  const re = new RegExp(`^${escapeRegex(verb)}(\\s+|$)`);
  return rawArgs.replace(re, "").trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
