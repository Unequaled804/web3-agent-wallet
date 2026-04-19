import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WalletContext } from "../../context.js";
import { ExecuteIntentInputShape } from "../../intent/schema.js";
import { dynamicValidate } from "../../intent/validator.js";
import { simulateIntent } from "../../chain/simulate.js";

export function registerExecuteIntent(server: McpServer, ctx: WalletContext) {
  server.tool(
    "wallet_execute_intent",
    [
      "Sign and broadcast an approved intent.",
      "Only intents with status='approved' are executable.",
      "Performs a final simulation + dynamic validation before sending.",
    ].join(" "),
    ExecuteIntentInputShape,
    async ({ intent_id, wait_for_receipt, receipt_timeout_seconds }) => {
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

      if (ctx.killSwitch.isEnabled()) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: "kill_switch_engaged",
                  intent_id,
                  kill_switch: ctx.killSwitch.snapshot(),
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      if (record.status !== "approved") {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: "intent_not_approved",
                  intent_id,
                  status: record.status,
                  status_reason: record.status_reason,
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

      if (!simulation.success || !validation.ok) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: "pre_execution_check_failed",
                  intent_id,
                  simulation,
                  validation: {
                    ok: validation.ok,
                    checks: validation.checks,
                    balance_wei: validation.balance_wei?.toString(),
                    estimated_gas: validation.estimated_gas?.toString(),
                    estimated_fee_wei: validation.estimated_fee_wei?.toString(),
                    total_cost_wei: validation.total_cost_wei?.toString(),
                  },
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      const tx_hash = await ctx.walletClient.sendTransaction({
        chain: undefined,
        account: ctx.account,
        to: record.intent.to,
        value: record.intent.value_wei,
        data: record.intent.data,
      });

      const broadcasted = ctx.intentStore.markBroadcasted({ intent_id, tx_hash });
      if (!broadcasted.ok) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: broadcasted.error,
                  intent_id,
                  tx_hash,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      if (!wait_for_receipt) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  intent_id,
                  request_id: record.intent.request_id,
                  status: broadcasted.record.status,
                  status_reason: broadcasted.record.status_reason,
                  execution: broadcasted.record.execution,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      try {
        const receipt = await ctx.publicClient.waitForTransactionReceipt({
          hash: tx_hash,
          timeout: receipt_timeout_seconds * 1000,
        });

        const confirmed = ctx.intentStore.markConfirmed({
          intent_id,
          block_number: receipt.blockNumber,
          gas_used: receipt.gasUsed,
          success: receipt.status === "success",
        });

        return {
          isError: !confirmed.ok || receipt.status !== "success",
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  intent_id,
                  request_id: record.intent.request_id,
                  status: confirmed.ok ? confirmed.record.status : "broadcasted",
                  status_reason: confirmed.ok
                    ? confirmed.record.status_reason
                    : "broadcasted_receipt_update_failed",
                  tx_hash,
                  receipt: {
                    status: receipt.status,
                    block_number: receipt.blockNumber.toString(),
                    gas_used: receipt.gasUsed.toString(),
                  },
                  execution: confirmed.ok
                    ? confirmed.record.execution
                    : broadcasted.record.execution,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: "broadcasted_but_receipt_wait_failed",
                  intent_id,
                  tx_hash,
                  detail: err instanceof Error ? err.message : String(err),
                },
                null,
                2,
              ),
            },
          ],
        };
      }
    },
  );
}
