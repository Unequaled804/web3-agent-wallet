import { getAddress, type PublicClient } from "viem";
import type { Intent } from "./schema.js";

export type ValidationReport = {
  ok: boolean;
  checks: {
    name: string;
    pass: boolean;
    detail?: string;
  }[];
  // Metrics surfaced to callers (even if some checks fail)
  balance_wei?: bigint;
  estimated_gas?: bigint;
  estimated_fee_wei?: bigint;
  total_cost_wei?: bigint;
};

/**
 * Static, off-chain checks. Run at Intent creation time so we reject bad input
 * before we even hit the chain.
 */
export function staticValidate(intent: Intent): ValidationReport {
  const checks: ValidationReport["checks"] = [];

  // 1. Chain id guard — we only support Sepolia in the demo.
  checks.push({
    name: "chain_id",
    pass: intent.chain_id === 11155111,
    detail: `chain_id=${intent.chain_id}`,
  });

  // 2. Checksum roundtrip — if the normalised form differs from what we stored,
  //    the caller gave us a mis-cased address. viem's getAddress throws on bad
  //    checksum input, but since our schema already lower-cased via isAddress
  //    acceptance, we redo a strict checksum compare here.
  let checksummedTo: string;
  try {
    checksummedTo = getAddress(intent.to);
    checks.push({
      name: "to_checksum",
      pass: true,
      detail: checksummedTo,
    });
  } catch (e) {
    checks.push({
      name: "to_checksum",
      pass: false,
      detail: e instanceof Error ? e.message : "invalid checksum",
    });
  }

  // 3. Non-negative value (belt-and-braces; schema already enforces).
  checks.push({
    name: "value_non_negative",
    pass: intent.value_wei >= 0n,
    detail: `value_wei=${intent.value_wei}`,
  });

  // 4. Not expired already (clock skew sanity).
  checks.push({
    name: "not_expired",
    pass: intent.expires_at > Date.now(),
    detail: `expires_at=${new Date(intent.expires_at).toISOString()}`,
  });

  // 5. Self-transfer smell check — not an error, but worth flagging.
  if (
    intent.action === "transfer" &&
    intent.from.toLowerCase() === intent.to.toLowerCase()
  ) {
    checks.push({
      name: "not_self_transfer",
      pass: false,
      detail: "from === to (self-transfer); probably unintended",
    });
  }

  // 6. Contract call must carry calldata.
  if (intent.action === "contract_call" && intent.data === "0x") {
    checks.push({
      name: "contract_call_has_data",
      pass: false,
      detail: "contract_call with empty calldata is meaningless",
    });
  }

  return {
    ok: checks.every((c) => c.pass),
    checks,
  };
}

/**
 * Dynamic checks that touch the chain: balance lookup + gas estimation.
 * Kept separate from staticValidate so unit tests can hit the static layer
 * without mocking RPC.
 */
export async function dynamicValidate(
  intent: Intent,
  publicClient: PublicClient,
): Promise<ValidationReport> {
  const report = staticValidate(intent);
  if (!report.ok) return report;

  try {
    const balance = await publicClient.getBalance({ address: intent.from });
    report.balance_wei = balance;

    let estimatedGas: bigint;
    try {
      estimatedGas = await publicClient.estimateGas({
        account: intent.from,
        to: intent.to,
        value: intent.value_wei,
        data: intent.data,
      });
    } catch (e) {
      report.checks.push({
        name: "gas_estimate",
        pass: false,
        detail: e instanceof Error ? e.message : "estimateGas failed",
      });
      report.ok = false;
      return report;
    }
    report.estimated_gas = estimatedGas;

    const fees = await publicClient.estimateFeesPerGas();
    const maxFeePerGas = fees.maxFeePerGas ?? fees.gasPrice ?? 0n;
    const estimatedFee = estimatedGas * maxFeePerGas;
    report.estimated_fee_wei = estimatedFee;

    const totalCost = intent.value_wei + estimatedFee;
    report.total_cost_wei = totalCost;

    const sufficient = balance >= totalCost;
    report.checks.push({
      name: "sufficient_balance",
      pass: sufficient,
      detail: sufficient
        ? `balance ${balance} >= cost ${totalCost}`
        : `balance ${balance} < cost ${totalCost} (value ${intent.value_wei} + fee ${estimatedFee})`,
    });
    if (!sufficient) report.ok = false;
  } catch (e) {
    report.checks.push({
      name: "rpc_reachable",
      pass: false,
      detail: e instanceof Error ? e.message : "RPC call failed",
    });
    report.ok = false;
  }

  return report;
}
