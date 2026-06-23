#!/usr/bin/env node
/** General Claude Code hook dispatch binary.
 *
 *  Invoked by a materialized `hooks.json` as:
 *    node gonk-claude-hook.js <specId> <specEvent>
 *  with the Claude hook payload on stdin and `CLAUDE_PLUGIN_ROOT` set to the
 *  plugin directory. It loads that plugin's bundled spec (`dist/hook-spec.js`,
 *  default export = spec or `() => spec`), runs the requested hook, and writes
 *  Claude's hook output JSON to stdout.
 *
 *  Fails soft: any error prints `{}` so a misconfigured hook never breaks the
 *  session. */

import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { runClaudeHook } from "../run-hook.ts";

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  // argv[2] is the specId — reserved/ignored: the spec is resolved from
  // CLAUDE_PLUGIN_ROOT, which Claude scopes per-plugin. argv[3] is the event.
  const specEvent = process.argv[3];
  const root = process.env.CLAUDE_PLUGIN_ROOT;
  if (!specEvent || !root) {
    process.stdout.write("{}");
    return;
  }

  let payload: unknown = {};
  try {
    const raw = await readStdin();
    if (raw.trim()) payload = JSON.parse(raw);
  } catch {
    // Malformed payload — proceed with an empty one.
  }

  try {
    const specPath = join(root, "dist", "hook-spec.cjs");
    const mod = (await import(pathToFileURL(specPath).href)) as Record<string, unknown>;
    // Unwrap CJS-interop default nesting: import() of a CJS bundle yields
    // { default: module.exports }, and tsup's `export default` adds another
    // `.default`. Peel until we reach the spec or its factory.
    let exported: unknown = mod.default ?? mod;
    if (exported && typeof exported === "object" && "default" in exported) {
      exported = (exported as { default: unknown }).default;
    }
    const spec = typeof exported === "function" ? (exported as () => unknown)() : exported;
    if (!spec || typeof spec !== "object" || !("id" in spec)) {
      // Fail soft, but loudly: a shape mismatch here usually means the bundler's
      // CJS-interop output shifted, which would otherwise silently stop all
      // persona injection. Name it so it's diagnosable.
      process.stderr.write(
        `[gonk-claude-hook] ${specPath} did not yield an ExtensionSpec (got ${typeof spec}); skipping\n`,
      );
      process.stdout.write("{}");
      return;
    }
    const out = await runClaudeHook(spec as Parameters<typeof runClaudeHook>[0], {
      specEvent,
      payload,
    });
    process.stdout.write(JSON.stringify(out));
  } catch (err) {
    process.stderr.write(`[gonk-claude-hook] ${err instanceof Error ? err.stack : String(err)}\n`);
    process.stdout.write("{}");
  }
}

void main();
