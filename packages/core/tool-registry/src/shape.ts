import type { StandardSchemaV1 } from "@standard-schema/spec";
import { type JsonSchema, withJsonSchema } from "./json-schema.ts";

/** Tiny in-tree Standard Schema adapter — wraps a runtime type-guard
 *  function in the `~standard` shape that `ToolDefinition.input` accepts.
 *
 *  Why this exists: gonk's core packages have a deliberate zero-dependency
 *  policy on schema libraries. Tool authors can use zod / valibot / arktype
 *  directly (they all implement Standard Schema natively), or use this
 *  helper to bridge a hand-written predicate when bringing a schema
 *  library would be overkill. Note: typebox 0.34 does NOT implement
 *  Standard Schema — pass a `shape()` guard or use a compatible library.
 *
 *  Example:
 *    interface MyInput { foo: string }
 *    const myInputSchema = shape<MyInput>(
 *      (v): v is MyInput =>
 *        !!v && typeof v === "object" && typeof (v as { foo?: unknown }).foo === "string",
 *      "expected { foo: string }",
 *    );
 */
export function shape<T>(
  check: (value: unknown) => value is T,
  message: string,
  jsonSchema?: JsonSchema,
): StandardSchemaV1<unknown, T> {
  const schema: StandardSchemaV1<unknown, T> = {
    "~standard": {
      version: 1,
      vendor: "gonk",
      validate: (value) => (check(value) ? { value } : { issues: [{ message }] }),
    },
  };
  return jsonSchema ? withJsonSchema(schema, jsonSchema) : schema;
}

/** Convenience: a shape that always passes (any value typed as T). Useful
 *  when the input is genuinely opaque to the tool — e.g. forwarded to a
 *  downstream system that does its own validation. */
export function passthrough<T = unknown>(): StandardSchemaV1<unknown, T> {
  return shape<T>((_v): _v is T => true, "passthrough");
}
