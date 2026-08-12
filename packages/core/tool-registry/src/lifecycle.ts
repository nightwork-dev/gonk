import type { ToolDefinition, ToolLifecycle } from "./types.ts";

/** Return the lifecycle notice shared by CLI, MCP, Pi, and orchestrator views. */
export function formatToolLifecycle(lifecycle: ToolLifecycle | undefined): string {
  if (lifecycle === undefined || lifecycle.status === "active") return "";
  const label = lifecycle.status === "deprecated" ? "Deprecated" : "Superseded";
  const replacement =
    lifecycle.replacement === undefined
      ? ""
      : ` Replacement: ${lifecycle.replacement}.`;
  const sunset = lifecycle.sunset === undefined ? "" : ` Sunset: ${lifecycle.sunset}.`;
  return `${label}: ${lifecycle.reason}.${replacement}${sunset}`;
}

/** Preserve the base description while exposing lifecycle state to hosts. */
export function formatToolDescription(tool: ToolDefinition): string {
  const notice = formatToolLifecycle(tool.lifecycle);
  if (!notice) return tool.description;
  const base = tool.description.trimEnd();
  return `${base}${base.endsWith(".") ? "" : "."} ${notice}`;
}
