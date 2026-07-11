#!/usr/bin/env node
import { dispatchCodexHook } from "../run-hook.ts";

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  const specEvent = process.argv[3];
  const root = process.env.PLUGIN_ROOT ?? process.env.CLAUDE_PLUGIN_ROOT;
  if (!specEvent || !root) {
    process.stdout.write("{}");
    return;
  }

  let payload: unknown = {};
  try {
    const raw = await readStdin();
    if (raw.trim()) payload = JSON.parse(raw);
  } catch {
    // Malformed host input fails soft and remains non-mutating.
  }

  try {
    const out = await dispatchCodexHook({ root, specEvent, payload });
    process.stdout.write(JSON.stringify(out));
  } catch (error) {
    process.stderr.write(`[gonk-codex-hook] ${error instanceof Error ? error.stack : String(error)}\n`);
    process.stdout.write("{}");
  }
}

void main();
