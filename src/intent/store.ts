import { randomUUID } from "node:crypto";
import type { Intent } from "./schema.js";
import type { ValidationReport } from "./validator.js";
import type { PolicyDecision, PolicyEvaluation } from "../policy/engine.js";

export type IntentStatus = PolicyDecision | "broadcasted" | "confirmed";

export type IntentValidationSnapshot = {
  ok: boolean;
  checks: {
    name: string;
    pass: boolean;
    detail?: string;
  }[];
  balance_wei?: string;
  estimated_gas?: string;
  estimated_fee_wei?: string;
  total_cost_wei?: string;
};

export type IntentReview = {
  decision: "approved" | "rejected";
  reviewed_at: number;
  reviewer?: string;
  reason?: string;
};

export type IntentRecord = {
  intent: Intent;
  status: IntentStatus;
  status_reason: string;
  policy?: PolicyEvaluation;
  validation?: IntentValidationSnapshot;
  review?: IntentReview;
  execution?: {
    tx_hash: string;
    broadcast_at: number;
    confirmed_at?: number;
    block_number?: string;
    gas_used?: string;
    success?: boolean;
  };
  created_at: number;
  updated_at: number;
};

export function snapshotValidationReport(
  report: ValidationReport,
): IntentValidationSnapshot {
  return {
    ok: report.ok,
    checks: report.checks,
    balance_wei: report.balance_wei?.toString(),
    estimated_gas: report.estimated_gas?.toString(),
    estimated_fee_wei: report.estimated_fee_wei?.toString(),
    total_cost_wei: report.total_cost_wei?.toString(),
  };
}

/**
 * In-memory intent store. Intents live here between create_intent and
 * execute_intent. M2 adds policy/approval status transitions.
 *
 * Scoped to the current process lifetime on purpose: a restart should not
 * leave half-signed proposals lying around.
 */
export class IntentStore {
  private intents = new Map<string, IntentRecord>();

  create(intent: Omit<Intent, "intent_id">): IntentRecord {
    const now = Date.now();
    const intent_id = `int_${randomUUID()}`;
    const full: Intent = { ...intent, intent_id };

    const record: IntentRecord = {
      intent: full,
      status: "pending_approval",
      status_reason: "awaiting_policy_evaluation",
      created_at: now,
      updated_at: now,
    };

    this.intents.set(intent_id, record);
    return record;
  }

  get(intent_id: string): Intent | undefined {
    const record = this.getRecord(intent_id);
    return record?.intent;
  }

  getRecord(intent_id: string): IntentRecord | undefined {
    const record = this.intents.get(intent_id);
    if (!record) return undefined;

    if (record.intent.expires_at <= Date.now()) {
      this.intents.delete(intent_id);
      return undefined;
    }
    return record;
  }

  list(): IntentRecord[] {
    this.gc();
    return [...this.intents.values()].sort((a, b) => b.intent.created_at - a.intent.created_at);
  }

  listPendingApproval(): IntentRecord[] {
    this.gc();
    return this.list().filter((record) => record.status === "pending_approval");
  }

  delete(intent_id: string): boolean {
    return this.intents.delete(intent_id);
  }

  setPolicyEvaluation(
    intent_id: string,
    policy: PolicyEvaluation,
    validation: IntentValidationSnapshot,
  ): IntentRecord | undefined {
    const record = this.getRecord(intent_id);
    if (!record) return undefined;

    record.policy = policy;
    record.validation = validation;
    record.status = policy.decision;
    record.status_reason = policy.reason;
    record.updated_at = Date.now();

    return record;
  }

  applyManualDecision(input: {
    intent_id: string;
    decision: "approved" | "rejected";
    reviewer?: string;
    reason?: string;
  }): { ok: true; record: IntentRecord } | { ok: false; error: string } {
    const record = this.getRecord(input.intent_id);
    if (!record) {
      return { ok: false, error: "intent_not_found_or_expired" };
    }

    if (record.status !== "pending_approval") {
      return {
        ok: false,
        error: `intent_not_pending_approval (current_status=${record.status})`,
      };
    }

    record.status = input.decision;
    record.status_reason = input.reason ?? `manual_${input.decision}`;
    record.review = {
      decision: input.decision,
      reviewer: input.reviewer,
      reason: input.reason,
      reviewed_at: Date.now(),
    };
    record.updated_at = Date.now();

    return { ok: true, record };
  }

  markBroadcasted(input: {
    intent_id: string;
    tx_hash: string;
  }): { ok: true; record: IntentRecord } | { ok: false; error: string } {
    const record = this.getRecord(input.intent_id);
    if (!record) {
      return { ok: false, error: "intent_not_found_or_expired" };
    }

    record.status = "broadcasted";
    record.status_reason = "transaction_broadcasted";
    record.execution = {
      tx_hash: input.tx_hash,
      broadcast_at: Date.now(),
    };
    record.updated_at = Date.now();

    return { ok: true, record };
  }

  markConfirmed(input: {
    intent_id: string;
    block_number: bigint;
    gas_used: bigint;
    success: boolean;
  }): { ok: true; record: IntentRecord } | { ok: false; error: string } {
    const record = this.getRecord(input.intent_id);
    if (!record) {
      return { ok: false, error: "intent_not_found_or_expired" };
    }

    if (!record.execution) {
      return { ok: false, error: "intent_not_broadcasted" };
    }

    record.status = "confirmed";
    record.status_reason = input.success
      ? "transaction_confirmed"
      : "transaction_reverted";
    record.execution = {
      ...record.execution,
      confirmed_at: Date.now(),
      block_number: input.block_number.toString(),
      gas_used: input.gas_used.toString(),
      success: input.success,
    };
    record.updated_at = Date.now();

    return { ok: true, record };
  }

  private gc() {
    const now = Date.now();
    for (const [id, record] of this.intents) {
      if (record.intent.expires_at <= now) this.intents.delete(id);
    }
  }
}
