import type { PublicClient } from "viem";
import type { Intent } from "../intent/schema.js";

export type SimulationResult = {
  success: boolean;
  revert_reason?: string;
  gas_used?: bigint;
  return_data?: string;
};

/**
 * Run the intent as an eth_call against the latest block. This is a pure read
 * that executes the EVM transition without touching state, so it catches:
 *   - reverts (bad calldata, failing require, onlyOwner, etc.)
 *   - insufficient balance at the from address
 *   - non-existent contract targets
 *
 * Separate from dynamicValidate so we can call simulate on demand even for
 * already-validated intents (e.g., price conditions may have moved).
 */
export async function simulateIntent(
  intent: Intent,
  publicClient: PublicClient,
): Promise<SimulationResult> {
  try {
    const result = await publicClient.call({
      account: intent.from,
      to: intent.to,
      value: intent.value_wei,
      data: intent.data,
    });
    return {
      success: true,
      return_data: result.data,
    };
  } catch (err) {
    return {
      success: false,
      revert_reason: err instanceof Error ? err.message : String(err),
    };
  }
}
