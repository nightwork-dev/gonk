import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { ToolDefinition } from "./types.ts";

export type JsonSchema = Record<string, unknown>;

export interface JsonSchemaAnnotated {
  /** Optional in-tree annotation used by zero-dependency schema helpers. */
  readonly "x-gonk-json-schema"?: JsonSchema;
}

export type JsonSchemaDerivableSchema = StandardSchemaV1<unknown, unknown> & JsonSchemaAnnotated;

/** Attach a JSON Schema projection to a Standard Schema without depending on
 * any concrete schema library. Schema libraries with native JSON Schema export
 * can pass the exported object here; in-tree shape() can attach it directly. */
export function withJsonSchema<S extends StandardSchemaV1<unknown, unknown>>(
  schema: S,
  jsonSchema: JsonSchema,
): S & Required<JsonSchemaAnnotated> {
  return Object.assign(schema, { "x-gonk-json-schema": jsonSchema });
}

/** Resolve the JSON Schema adapters advertise for a tool input.
 *
 * Tools may override with inputJsonSchema. Otherwise core reads the optional
 * zero-dependency annotation placed on Standard Schema values by shape(...,
 * jsonSchema) / withJsonSchema(...). If neither is present, the safe fallback is
 * an unconstrained schema; callers that need a richer surface should provide an
 * override or an annotated schema.
 *
 * NOTE: the returned schema is TRUSTED, not derived — `withJsonSchema` attaches
 * whatever object you pass and this returns it verbatim, even if it contradicts
 * the schema's runtime `validate`. (You cannot reflect JSON Schema out of an
 * arbitrary Standard Schema predicate.) A consumer generating a form or a
 * model-facing tool description off this schema is trusting the annotation to
 * stay in step with runtime validation — keep them in sync at the source. */
export function resolveInputJsonSchema(tool: Pick<ToolDefinition, "input" | "inputJsonSchema">): JsonSchema {
  if (tool.inputJsonSchema) return tool.inputJsonSchema;
  const annotated = tool.input as JsonSchemaDerivableSchema;
  return annotated["x-gonk-json-schema"] ?? {};
}
