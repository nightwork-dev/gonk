import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Resolve a materialized Claude plugin's hook runtime.
 *
 * ESM is preferred because adapters may depend on modules that use top-level
 * await. CommonJS remains a fallback for existing plugin packages.
 */
export function resolveClaudeHookSpecPath(root: string): string {
  const esmPath = join(root, "dist", "hook-spec.mjs");
  if (existsSync(esmPath)) return esmPath;

  const cjsPath = join(root, "dist", "hook-spec.cjs");
  if (existsSync(cjsPath)) return cjsPath;

  return esmPath;
}
