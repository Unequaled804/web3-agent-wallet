import { describe, expect, it } from "vitest";
import { SEPOLIA_CHAIN_ID, type Intent } from "../schema.js";
import { IntentStore, snapshotValidationReport } from "../store.js";
import type { PolicyEvaluation } from "../../policy/engine.js";

function makeIntent(overrides: Partial<Omit<Intent, "intent_id">> = {}): Omit<Intent, "intent_id"> {
  const now = Date.now();
  return {
    request_id: "req_test",
    chain_id: SEPOLIA_CHAIN_ID,
    action: "transfer",
    from: "0x1111111111111111111111111111111111111111",
    to: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
    value_wei: 10n ** 15n,
    value_display: { amount: "0.001", unit: "ether" },
    data: "0x",
    created_at: now,
    expires_at: now + 60_000,
    ...overrides,
  };
}

function makePolicy(decision: PolicyEvaluation["decision"]): PolicyEvaluation {
  return {
    decision,
    reason: `policy_${decision}`,
    matched_rules: ["test_rule"],
    requires_human_approval: decision === "pending_approval",
    evaluated_at: Date.now(),
  };
}

describe("IntentStore", () => {
  it("stores policy evaluation and supports manual approval", () => {
    const store = new IntentStore();
    const created = store.create(makeIntent());

    const updated = store.setPolicyEvaluation(
      created.intent.intent_id,
      makePolicy("pending_approval"),
      snapshotValidationReport({ ok: true, checks: [] }),
    );

    expect(updated?.status).toBe("pending_approval");
    expect(store.listPendingApproval().length).toBe(1);

    const reviewed = store.applyManualDecision({
      intent_id: created.intent.intent_id,
      decision: "approved",
      reviewer: "alice",
      reason: "looks safe",
    });

    expect(reviewed.ok).toBe(true);
    if (reviewed.ok) {
      expect(reviewed.record.status).toBe("approved");
      expect(reviewed.record.review?.reviewer).toBe("alice");
    }
  });

  it("rejects manual review if intent is not pending", () => {
    const store = new IntentStore();
    const created = store.create(makeIntent());

    store.setPolicyEvaluation(
      created.intent.intent_id,
      makePolicy("rejected"),
      snapshotValidationReport({ ok: false, checks: [{ name: "x", pass: false }] }),
    );

    const reviewed = store.applyManualDecision({
      intent_id: created.intent.intent_id,
      decision: "approved",
    });

    expect(reviewed.ok).toBe(false);
  });

  it("expires intents on read", () => {
    const store = new IntentStore();
    const created = store.create(
      makeIntent({
        created_at: Date.now() - 20_000,
        expires_at: Date.now() - 10_000,
      }),
    );

    const record = store.getRecord(created.intent.intent_id);
    expect(record).toBeUndefined();
  });

  it("tracks broadcast and confirmation metadata", () => {
    const store = new IntentStore();
    const created = store.create(makeIntent());

    store.setPolicyEvaluation(
      created.intent.intent_id,
      makePolicy("approved"),
      snapshotValidationReport({ ok: true, checks: [] }),
    );

    const broadcasted = store.markBroadcasted({
      intent_id: created.intent.intent_id,
      tx_hash: "0x1234",
    });
    expect(broadcasted.ok).toBe(true);
    if (!broadcasted.ok) return;
    expect(broadcasted.record.status).toBe("broadcasted");
    expect(broadcasted.record.execution?.tx_hash).toBe("0x1234");

    const confirmed = store.markConfirmed({
      intent_id: created.intent.intent_id,
      block_number: 123n,
      gas_used: 21000n,
      success: true,
    });
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    expect(confirmed.record.status).toBe("confirmed");
    expect(confirmed.record.execution?.block_number).toBe("123");
    expect(confirmed.record.execution?.gas_used).toBe("21000");
    expect(confirmed.record.execution?.success).toBe(true);
  });
});
