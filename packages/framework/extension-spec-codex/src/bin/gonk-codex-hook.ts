#!/usr/bin/env node
import { dispatchCodexHook } from "../run-hook.ts";
import type { CodexHookPlacementAuthorization } from "../types.ts";

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  const specId = process.argv[2];
  const specEvent = process.argv[3];
  const placementKind = process.argv[4];
  const codexEvent = process.argv[5];
  const root = process.env.PLUGIN_ROOT ?? process.env.CLAUDE_PLUGIN_ROOT;
  if (!specId || !specEvent || !placementKind || !codexEvent || !root) {
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
    const out = await dispatchCodexHook({
      root,
      specId,
      specEvent,
      placement: { kind: placementKind, event: codexEvent } as CodexHookPlacementAuthorization,
      payload,
    });
    process.stdout.write(JSON.stringify(out));
  } catch (error) {
    process.stderr.write(`[gonk-codex-hook] ${error instanceof Error ? error.stack : String(error)}\n`);
    process.stdout.write("{}");
  }
}

void main();
