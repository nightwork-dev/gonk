/** Reconstruct a spec-framework-compatible rawArgs string from an argv slice.
 *
 *  Background: the spec framework's `parseSubcommandArgs` takes a single
 *  rawArgs string (`"gen 'a cat' --n 3"`) and tokenizes it. The CLI receives
 *  a pre-tokenized argv (`["gen", "a cat", "--n", "3"]`) but needs the spec
 *  framework's parser for parity with the Pi runtime. We re-quote here so
 *  the parser sees what it expects.
 *
 *  Quote rules:
 *    - args with no whitespace and no quotes → bare
 *    - args with whitespace and no single quotes → wrap in single quotes
 *    - args containing a single quote (but no double quote) → wrap in double quotes
 *    - args containing BOTH single and double quotes → throw (parser has no escapes)
 */
export function argvToRawArgs(argv: readonly string[]): string {
  return argv.map(quote).join(" ").trim();
}

function quote(arg: string): string {
  if (!/\s/.test(arg) && !arg.includes("'") && !arg.includes('"')) {
    return arg;
  }
  if (!arg.includes("'")) {
    return `'${arg}'`;
  }
  if (arg.includes('"')) {
    throw new Error(`argvToRawArgs: cannot represent arg containing both ' and " (parser does not support escapes): ${arg}`);
  }
  return `"${arg}"`;
}
