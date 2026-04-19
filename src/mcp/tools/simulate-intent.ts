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
      const record = ctx.intentStore.getRecord(intent_id);
      if (!record) {
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
        simulateIntent(record.intent, ctx.publicClient),
        dynamicValidate(record.intent, ctx.publicClient),
      ]);

      const killSwitch = ctx.killSwitch.snapshot();
      const verdict =
        record.status === "rejected"
          ? "rejected_by_policy"
          : record.status === "pending_approval"
            ? "awaiting_human_approval"
            : record.status === "broadcasted" || record.status === "confirmed"
              ? "already_executed"
              : !simulation.success || !validation.ok
                ? "blocked"
                : killSwitch.enabled
                  ? "blocked_by_kill_switch"
                  : "ready_to_execute";

      const payload = {
        intent_id,
        request_id: record.intent.request_id,
        status: record.status,
        status_reason: record.status_reason,
        policy: record.policy,
        queued_for_approval: ctx.approvalQueue.has(intent_id),
        kill_switch: killSwitch,
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
        verdict,
      };

      return {
        isError: verdict !== "ready_to_execute",
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    },
  );
}
