import type { StandardSchemaV1 } from "@standard-schema/spec";

export async function validateStandard<T>(
  schema: StandardSchemaV1<unknown, T>,
  value: unknown,
  label: string
): Promise<T> {
  const result = await schema["~standard"].validate(value);
  if ("issues" in result) {
    throw new TypeError(`Invalid ${label}`);
  }
  return result.value;
}

export function validateStandardSync<T>(
  schema: StandardSchemaV1<unknown, T>,
  value: unknown,
  label: string
): T {
  const result = schema["~standard"].validate(value);
  if (result instanceof Promise) {
    throw new TypeError(`${label} schema must validate synchronously`);
  }
  if ("issues" in result) {
    throw new TypeError(`Invalid ${label}`);
  }
  return result.value;
}
