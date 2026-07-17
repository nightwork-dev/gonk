import { createHash } from "node:crypto";

import {
  createScope,
  SCOPE_RESOLUTION_ORDER,
  type ScopeEnvironment,
  type ScopeName,
} from "@gonk/scope";
import { createStore, type KvStore, type Store } from "@gonk/store";

import {
  skillActivationJournalRecordSchema,
  skillMutationJournalRecordSchema,
} from "./schemas.ts";
import type {
  SkillActivationJournalQuery,
  SkillActivationJournalRecord,
  SkillActivationJournalWrite,
  SkillActivationReceipt,
  SkillLifecycleJournal,
  SkillMutationJournalQuery,
  SkillMutationJournalRecord,
  SkillMutationJournalWrite,
  SkillMutationReceipt,
} from "./types.ts";

const JOURNAL_NAMESPACE = "skills.lifecycle";
const MUTATION_PREFIX = "mutation:";
const ACTIVATION_PREFIX = "activation:";

/**
 * Restart-durable lifecycle receipts stored under each scope's hidden
 * `.agents/store/skills.lifecycle` namespace. The backing KV store provides
 * atomic temp-file-plus-rename writes.
 */
export class FilesystemSkillLifecycleJournal implements SkillLifecycleJournal {
  private readonly store: Store;

  constructor(env: ScopeEnvironment) {
    this.store = createStore(createScope(env));
  }

  readMutation(query: SkillMutationJournalQuery): SkillMutationReceipt | undefined {
    const receiptId = mutationReceiptId(query);
    const key = mutationKey(receiptId);
    for (const scope of SCOPE_RESOLUTION_ORDER) {
      const record = parseMutationRecord(this.kv(scope).get(key));
      if (
        record &&
        record.securityContextKey === query.securityContextKey &&
        record.receipt.receiptId === receiptId &&
        record.receipt.operation === query.operation &&
        record.receipt.scope === scope
      ) {
        return record.receipt;
      }
    }
    return undefined;
  }

  writeMutation(input: SkillMutationJournalWrite): SkillMutationReceipt {
    const receipt: SkillMutationReceipt = {
      kind: "skill-mutation",
      receiptVersion: 1,
      receiptId: mutationReceiptId(input),
      timestamp: input.timestamp,
      operation: input.operation,
      requestFingerprint: input.requestFingerprint,
      id: input.id,
      scope: input.scope,
      result: input.result,
    };
    const record: SkillMutationJournalRecord = {
      kind: "skill-mutation-journal",
      recordVersion: 1,
      securityContextKey: input.securityContextKey,
      receipt,
    };
    assertValid(skillMutationJournalRecordSchema, record, "mutation journal record");
    const existing = this.readMutation(input);
    if (existing) {
      if (stableJson(existing) === stableJson(receipt)) return existing;
      throw new Error("Mutation receipt already exists with different content");
    }
    this.kv(input.scope).set(mutationKey(receipt.receiptId), record);
    return receipt;
  }

  readActivation(query: SkillActivationJournalQuery): SkillActivationReceipt | undefined {
    const key = activationKey(query.securityContextKey, query.activationId);
    for (const scope of SCOPE_RESOLUTION_ORDER) {
      const record = parseActivationRecord(this.kv(scope).get(key));
      if (
        record &&
        record.securityContextKey === query.securityContextKey &&
        record.receipt.activationId === query.activationId &&
        record.receipt.scope === scope
      ) {
        return record.receipt;
      }
    }
    return undefined;
  }

  listActivations(securityContextKey: string): readonly SkillActivationReceipt[] {
    const receipts: SkillActivationReceipt[] = [];
    for (const scope of SCOPE_RESOLUTION_ORDER) {
      for (const { value } of this.kv(scope).entries(ACTIVATION_PREFIX)) {
        const record = parseActivationRecord(value);
        if (
          record &&
          record.securityContextKey === securityContextKey &&
          record.receipt.scope === scope
        ) {
          receipts.push(record.receipt);
        }
      }
    }
    return receipts.sort((left, right) =>
      left.timestamp === right.timestamp
        ? compareOpaque(left.activationId, right.activationId)
        : compareOpaque(left.timestamp, right.timestamp)
    );
  }

  writeActivation(input: SkillActivationJournalWrite): void {
    const record: SkillActivationJournalRecord = {
      kind: "skill-activation-journal",
      recordVersion: 1,
      securityContextKey: input.securityContextKey,
      receipt: input.receipt,
    };
    assertValid(skillActivationJournalRecordSchema, record, "activation journal record");
    const existing = this.readActivation({
      securityContextKey: input.securityContextKey,
      activationId: input.receipt.activationId,
    });
    if (existing) {
      if (stableJson(existing) === stableJson(input.receipt)) return;
      throw new Error("Activation receipt already exists with different content");
    }
    this.kv(input.receipt.scope).set(
      activationKey(input.securityContextKey, input.receipt.activationId),
      record
    );
  }

  private kv(scope: ScopeName): KvStore<unknown> {
    return this.store.kv(scope, JOURNAL_NAMESPACE);
  }
}

function mutationReceiptId(query: SkillMutationJournalQuery): string {
  return hashOpaque(
    "skill-mutation-receipt-v1",
    query.operation,
    query.securityContextKey,
    query.idempotencyKey
  );
}

function mutationKey(receiptId: string): string {
  return `${MUTATION_PREFIX}${receiptId.slice("sha256:".length)}`;
}

function activationKey(securityContextKey: string, activationId: string): string {
  return `${ACTIVATION_PREFIX}${hashOpaque(
    "skill-activation-receipt-v1",
    securityContextKey,
    activationId
  ).slice("sha256:".length)}`;
}

function hashOpaque(...parts: readonly string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    const bytes = Buffer.from(part, "utf8");
    const length = Buffer.allocUnsafe(8);
    length.writeBigUInt64BE(BigInt(bytes.byteLength));
    hash.update(length);
    hash.update(bytes);
  }
  return `sha256:${hash.digest("hex")}`;
}

function parseMutationRecord(value: unknown): SkillMutationJournalRecord | undefined {
  return parseValid(skillMutationJournalRecordSchema, value);
}

function parseActivationRecord(value: unknown): SkillActivationJournalRecord | undefined {
  return parseValid(skillActivationJournalRecordSchema, value);
}

function parseValid<T>(
  schema: { readonly "~standard": { validate(value: unknown): unknown } },
  value: unknown
): T | undefined {
  const result = schema["~standard"].validate(value);
  if (!result || typeof result !== "object" || "issues" in result || !("value" in result)) {
    return undefined;
  }
  return result.value as T;
}

function assertValid(
  schema: { readonly "~standard": { validate(value: unknown): unknown } },
  value: unknown,
  label: string
): void {
  if (parseValid(schema, value) === undefined) {
    throw new TypeError(`Invalid ${label}`);
  }
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function compareOpaque(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
