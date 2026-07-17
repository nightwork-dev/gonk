import { isAbsolute } from "node:path";

const RESERVED_IDS = new Set([".staging", ".archive", "skill.md"]);
const SKILL_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;

export function isManagedSkillId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    SKILL_ID.test(value) &&
    !RESERVED_IDS.has(value.toLowerCase())
  );
}

export function isManagedSkillPath(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\\") ||
    isAbsolute(value) ||
    value.startsWith("/")
  ) {
    return false;
  }
  return value
    .split("/")
    .every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}
