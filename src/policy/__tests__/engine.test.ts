import { describe, expect, it } from "vitest";
import { SEPOLIA_CHAIN_ID, type Intent } from "../../intent/schema.js";
import type { ValidationReport } from "../../intent/validator.js";
import { KillSwitch } from "../../killswitch/state.js";
import { PolicyEngine } from "../engine.js";

function makeIntent(overrides: Partial<Intent> = {}): Intent {
  const now = Date.now();
  return {
    intent_id: "int_test",
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

const okValidation: ValidationReport = {
  ok: true,
  checks: [],
};

describe("PolicyEngine", () => {
  it("auto-approves low-value transfers", () => {
    const killSwitch = new KillSwitch();
    const engine = new PolicyEngine(
      {
        autoApproveMaxWei: 10n ** 16n,
        hardMaxWei: 10n ** 17n,
        allowedTo: new Set(),
        blockedTo: new Set(),
      },
      killSwitch,
    );

    const result = engine.evaluate(makeIntent(), okValidation);
    expect(result.decision).toBe("approved");
  });

  it("requires approval above the auto-approve limit", () => {
    const killSwitch = new KillSwitch();
    const engine = new PolicyEngine(
      {
        autoApproveMaxWei: 10n ** 16n,
        hardMaxWei: 10n ** 17n,
        allowedTo: new Set(),
        blockedTo: new Set(),
      },
      killSwitch,
    );

    const result = engine.evaluate(
      makeIntent({ value_wei: 2n * 10n ** 16n, value_display: { amount: "0.02", unit: "ether" } }),
      okValidation,
    );
    expect(result.decision).toBe("pending_approval");
  });

  it("rejects above hard limit", () => {
    const killSwitch = new KillSwitch();
    const engine = new PolicyEngine(
      {
        autoApproveMaxWei: 10n ** 16n,
        hardMaxWei: 10n ** 17n,
        allowedTo: new Set(),
        blockedTo: new Set(),
      },
      killSwitch,
    );

    const result = engine.evaluate(
      makeIntent({ value_wei: 2n * 10n ** 17n, value_display: { amount: "0.2", unit: "ether" } }),
      okValidation,
    );
    expect(result.decision).toBe("rejected");
    expect(result.reason).toBe("amount_above_hard_limit");
  });

  it("rejects when kill switch is engaged", () => {
    const killSwitch = new KillSwitch();
    killSwitch.engage("ops_freeze", "security");

    const engine = new PolicyEngine(
      {
        autoApproveMaxWei: 10n ** 16n,
        hardMaxWei: 10n ** 17n,
        allowedTo: new Set(),
        blockedTo: new Set(),
      },
      killSwitch,
    );

    const result = engine.evaluate(makeIntent(), okValidation);
    expect(result.decision).toBe("rejected");
    expect(result.reason).toBe("kill_switch_engaged");
  });

  it("requires approval for contract calls", () => {
    const killSwitch = new KillSwitch();
    const engine = new PolicyEngine(
      {
        autoApproveMaxWei: 10n ** 16n,
        hardMaxWei: 10n ** 17n,
        allowedTo: new Set(),
        blockedTo: new Set(),
      },
      killSwitch,
    );

    const result = engine.evaluate(
      makeIntent({ action: "contract_call", data: "0xabcdef" }),
      okValidation,
    );
    expect(result.decision).toBe("pending_approval");
  });

  it("rejects blocklisted recipients", () => {
    const killSwitch = new KillSwitch();
    const engine = new PolicyEngine(
      {
        autoApproveMaxWei: 10n ** 16n,
        hardMaxWei: 10n ** 17n,
        allowedTo: new Set(),
        blockedTo: new Set(["0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed"]),
      },
      killSwitch,
    );

    const result = engine.evaluate(makeIntent(), okValidation);
    expect(result.decision).toBe("rejected");
    expect(result.reason).toBe("recipient_blocklisted");
  });

  it("supports runtime policy updates", () => {
    const killSwitch = new KillSwitch();
    const engine = new PolicyEngine(
      {
        autoApproveMaxWei: 10n ** 16n,
        hardMaxWei: 10n ** 17n,
        allowedTo: new Set(),
        blockedTo: new Set(),
      },
      killSwitch,
    );

    engine.applyUpdate({
      auto_approve_max_wei: "1000",
      hard_max_wei: "2000",
      allowed_to: ["0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"],
      max_tx_per_minute: 2,
      max_tx_per_hour: 10,
    });

    const snapshot = engine.getConfigSnapshot();
    expect(snapshot.auto_approve_max_wei).toBe("1000");
    expect(snapshot.hard_max_wei).toBe("2000");
    expect(snapshot.allowed_to).toEqual([
      "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed",
    ]);
    expect(snapshot.max_tx_per_minute).toBe(2);
    expect(snapshot.max_tx_per_hour).toBe(10);
  });

  it("throws when auto-approve exceeds hard limit", () => {
    const killSwitch = new KillSwitch();
    const engine = new PolicyEngine(
      {
        autoApproveMaxWei: 10n,
        hardMaxWei: 100n,
        allowedTo: new Set(),
        blockedTo: new Set(),
      },
      killSwitch,
    );

    expect(() =>
      engine.applyUpdate({
        auto_approve_max_wei: "1000",
        hard_max_wei: "999",
      }),
    ).toThrow(/cannot exceed hard_max_wei/);

    const snapshot = engine.getConfigSnapshot();
    expect(snapshot.auto_approve_max_wei).toBe("10");
    expect(snapshot.hard_max_wei).toBe("100");
  });

  it("downgrades to pending approval when minute frequency limit is reached", () => {
    const killSwitch = new KillSwitch();
    const engine = new PolicyEngine(
      {
        autoApproveMaxWei: 10n ** 16n,
        hardMaxWei: 10n ** 17n,
        allowedTo: new Set(),
        blockedTo: new Set(),
        maxTxPerMinute: 2,
      },
      killSwitch,
    );

    const now = Date.now();
    engine.recordBroadcast(now - 10_000);
    engine.recordBroadcast(now - 5_000);

    const result = engine.evaluate(makeIntent(), okValidation);
    expect(result.decision).toBe("pending_approval");
    expect(result.reason).toBe("frequency_limit_minute_exceeded");
  });
});
