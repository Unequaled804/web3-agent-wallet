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
    async ({ agent_id, intent_id, wait_for_receipt, receipt_timeout_seconds }) => {
      const record = ctx.intentStore.getRecord(intent_id);
      if (!record) {
        await ctx.auditStore.logEvent({
          event_type: "intent_execute_failed",
          intent_id,
          status: "rejected",
          payload: { error: "intent_not_found_or_expired" },
        });
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

      const binding = ctx.bindingManager.getState();
      if (binding.bound_agent_id) {
        if (!agent_id) {
          await ctx.auditStore.logEvent({
            event_type: "intent_execute_blocked",
            intent_id,
            status: "rejected",
            payload: {
              error: "agent_id_required_when_bound",
              bound_agent_id: binding.bound_agent_id,
            },
          });
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    error: "agent_id_required_when_bound",
                    bound_agent_id: binding.bound_agent_id,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }
        if (agent_id !== binding.bound_agent_id) {
          await ctx.auditStore.logEvent({
            event_type: "intent_execute_blocked",
            intent_id,
            status: "rejected",
            payload: {
              error: "agent_not_bound",
              provided_agent_id: agent_id,
              bound_agent_id: binding.bound_agent_id,
            },
          });
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    error: "agent_not_bound",
                    provided_agent_id: agent_id,
                    bound_agent_id: binding.bound_agent_id,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }
      }

      if (ctx.killSwitch.isEnabled()) {
        await ctx.auditStore.logEvent({
          event_type: "intent_execute_blocked",
          request_id: record.intent.request_id,
          intent_id,
          chain_id: record.intent.chain_id,
          from_address: record.intent.from,
          to_address: record.intent.to,
          value_wei: record.intent.value_wei.toString(),
          status: "rejected",
          payload: {
            error: "kill_switch_engaged",
            kill_switch: ctx.killSwitch.snapshot(),
          },
        });
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
        await ctx.auditStore.logEvent({
          event_type: "intent_execute_blocked",
          request_id: record.intent.request_id,
          intent_id,
          chain_id: record.intent.chain_id,
          from_address: record.intent.from,
          to_address: record.intent.to,
          value_wei: record.intent.value_wei.toString(),
          status: record.status,
          payload: {
            error: "intent_not_approved",
            status_reason: record.status_reason,
          },
        });
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
        await ctx.auditStore.logEvent({
          event_type: "intent_execute_precheck_failed",
          request_id: record.intent.request_id,
          intent_id,
          chain_id: record.intent.chain_id,
          from_address: record.intent.from,
          to_address: record.intent.to,
          value_wei: record.intent.value_wei.toString(),
          status: "rejected",
          payload: {
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
        });
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
        await ctx.auditStore.logEvent({
          event_type: "intent_broadcast_failed",
          request_id: record.intent.request_id,
          intent_id,
          chain_id: record.intent.chain_id,
          from_address: record.intent.from,
          to_address: record.intent.to,
          value_wei: record.intent.value_wei.toString(),
          status: "rejected",
          tx_hash,
          payload: {
            error: broadcasted.error,
          },
        });
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

      await ctx.auditStore.logEvent({
        event_type: "intent_broadcasted",
        request_id: record.intent.request_id,
        intent_id,
        chain_id: record.intent.chain_id,
        from_address: record.intent.from,
        to_address: record.intent.to,
        value_wei: record.intent.value_wei.toString(),
        status: broadcasted.record.status,
        tx_hash,
        payload: {
          execution: broadcasted.record.execution,
        },
      });
      ctx.policyEngine.recordBroadcast();

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

        await ctx.auditStore.logEvent({
          event_type: "intent_confirmed",
          request_id: record.intent.request_id,
          intent_id,
          chain_id: record.intent.chain_id,
          from_address: record.intent.from,
          to_address: record.intent.to,
          value_wei: record.intent.value_wei.toString(),
          status: receipt.status === "success" ? "confirmed" : "reverted",
          tx_hash,
          payload: {
            receipt: {
              status: receipt.status,
              block_number: receipt.blockNumber.toString(),
              gas_used: receipt.gasUsed.toString(),
            },
            store_update_ok: confirmed.ok,
            store_update_error: confirmed.ok ? undefined : confirmed.error,
          },
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
        await ctx.auditStore.logEvent({
          event_type: "intent_receipt_wait_failed",
          request_id: record.intent.request_id,
          intent_id,
          chain_id: record.intent.chain_id,
          from_address: record.intent.from,
          to_address: record.intent.to,
          value_wei: record.intent.value_wei.toString(),
          status: "broadcasted",
          tx_hash,
          payload: {
            error: err instanceof Error ? err.message : String(err),
          },
        });
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
