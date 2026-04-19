import { describe, it, expect } from "vitest";
import { humanize } from "../humanize.js";
import { SEPOLIA_CHAIN_ID, type Intent } from "../schema.js";
import type { ValidationReport } from "../validator.js";

const now = Date.now();
const intent: Intent = {
  intent_id: "int_abc",
  request_id: "req_xyz",
  chain_id: SEPOLIA_CHAIN_ID,
  action: "transfer",
  from: "0x1111111111111111111111111111111111111111",
  to: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
  value_wei: 10n ** 17n,
  value_display: { amount: "0.1", unit: "ether" },
  data: "0x",
  created_at: now,
  expires_at: now + 60_000,
  note: "routine payout",
};

describe("humanize", () => {
  it("surfaces amount, recipient and note for a transfer", () => {
    const text = humanize(intent);
    expect(text).toContain("0.1 ETH");
    expect(text).toContain("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed");
    expect(text).toContain("routine payout");
    expect(text).toContain("int_abc");
  });

  it("renders fee + balance lines when a report is provided", () => {
    const report: ValidationReport = {
      ok: true,
      checks: [],
      balance_wei: 10n ** 18n,
      estimated_gas: 21000n,
      estimated_fee_wei: 21000n * 2_000_000_000n,
      total_cost_wei: 10n ** 17n + 21000n * 2_000_000_000n,
    };
    const text = humanize(intent, report);
    expect(text).toContain("Estimated gas: 21000");
    expect(text).toContain("SUFFICIENT");
  });

  it("surfaces failed checks when report.ok is false", () => {
    const report: ValidationReport = {
      ok: false,
      checks: [
        { name: "sufficient_balance", pass: false, detail: "balance too low" },
      ],
    };
    const text = humanize(intent, report);
    expect(text).toContain("Failed checks");
    expect(text).toContain("sufficient_balance");
  });
});
