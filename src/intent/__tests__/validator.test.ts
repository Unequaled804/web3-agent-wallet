import { describe, it, expect } from "vitest";
import { staticValidate } from "../validator.js";
import { SEPOLIA_CHAIN_ID, type Intent } from "../schema.js";

function makeIntent(overrides: Partial<Intent> = {}): Intent {
  const now = Date.now();
  return {
    intent_id: "int_test",
    request_id: "req_test",
    chain_id: SEPOLIA_CHAIN_ID,
    action: "transfer",
    from: "0x1111111111111111111111111111111111111111",
    to: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
    value_wei: 10n ** 16n,
    value_display: { amount: "0.01", unit: "ether" },
    data: "0x",
    created_at: now,
    expires_at: now + 5 * 60 * 1000,
    ...overrides,
  };
}

describe("staticValidate", () => {
  it("passes a clean transfer", () => {
    const report = staticValidate(makeIntent());
    expect(report.ok).toBe(true);
  });

  it("rejects the wrong chain", () => {
    const report = staticValidate(
      makeIntent({ chain_id: 1 as unknown as typeof SEPOLIA_CHAIN_ID }),
    );
    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.name === "chain_id")?.pass).toBe(false);
  });

  it("flags self-transfer", () => {
    const addr = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed" as const;
    const report = staticValidate(makeIntent({ from: addr, to: addr }));
    expect(report.ok).toBe(false);
    const check = report.checks.find((c) => c.name === "not_self_transfer");
    expect(check).toBeDefined();
    expect(check?.pass).toBe(false);
  });

  it("rejects already-expired intent", () => {
    const report = staticValidate(makeIntent({ expires_at: Date.now() - 1000 }));
    expect(report.ok).toBe(false);
  });

  it("rejects contract_call without calldata", () => {
    const report = staticValidate(
      makeIntent({ action: "contract_call", data: "0x" }),
    );
    expect(report.ok).toBe(false);
  });
});
