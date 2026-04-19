import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WalletContext } from "../../context.js";
import { SimulateIntentInputShape } from "../../intent/schema.js";
import { simulateIntent } from "../../chain/simulate.js";
import { dynamicValidate } from "../../intent/validator.js";

export function registerSimulateIntent(server: McpServer, ctx: WalletContext) {
  server.tool(
    "wallet_simulate_intent",
    [
      "Dry-run a previously created Intent via eth_call (no state change, no",
      "signature). Returns whether the EVM execution would succeed, revert",
      "reason if any, and a fresh balance/fee snapshot. Use this right before",
      "execute_intent to confirm on-chain state still matches expectations.",
    ].join(" "),
    SimulateIntentInputShape,
    async ({ intent_id }) => {
      const intent = ctx.intentStore.get(intent_id);
      if (!intent) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: "intent_not_found_or_expired",
                  intent_id,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      const [simulation, validation] = await Promise.all([
        simulateIntent(intent, ctx.publicClient),
        dynamicValidate(intent, ctx.publicClient),
      ]);

      const payload = {
        intent_id,
        request_id: intent.request_id,
        simulation: {
          success: simulation.success,
          revert_reason: simulation.revert_reason,
          return_data: simulation.return_data,
        },
        validation: {
          ok: validation.ok,
          checks: validation.checks,
          balance_wei: validation.balance_wei?.toString(),
          estimated_gas: validation.estimated_gas?.toString(),
          estimated_fee_wei: validation.estimated_fee_wei?.toString(),
          total_cost_wei: validation.total_cost_wei?.toString(),
        },
        verdict: simulation.success && validation.ok ? "ready_to_execute" : "blocked",
      };

      return {
        isError: !(simulation.success && validation.ok),
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    },
  );
}
