import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { randomUUID } from "node:crypto";
import { getAddress } from "viem";
import type { WalletContext } from "../../context.js";
import {
  CreateIntentInputShape,
  SEPOLIA_CHAIN_ID,
  parseValueToWei,
  validateCreateIntentInput,
  type CreateIntentInput,
  type Intent,
} from "../../intent/schema.js";
import { dynamicValidate } from "../../intent/validator.js";
import { humanize } from "../../intent/humanize.js";
import { snapshotValidationReport } from "../../intent/store.js";

export function registerCreateIntent(server: McpServer, ctx: WalletContext) {
  server.tool(
    "wallet_create_intent",
    [
      "Propose a structured transaction Intent. The wallet validates it (address",
      "checksum, balance, fee) and runs policy checks, but does NOT sign or",
      "broadcast. Returns an intent_id plus status/policy. Pending intents",
      "must be approved via wallet_review_intent before execute_intent in M3.",
    ].join(" "),
    CreateIntentInputShape,
    async (rawInput) => {
      const input = rawInput as CreateIntentInput;

      const structuralErrors = validateCreateIntentInput(input);
      if (structuralErrors.length > 0) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { error: "invalid_intent", details: structuralErrors },
                null,
                2,
              ),
            },
          ],
        };
      }

      const value_wei = parseValueToWei(input.value);
      const now = Date.now();
      const intent: Omit<Intent, "intent_id"> = {
        request_id: input.request_id ?? `req_${randomUUID()}`,
        chain_id: SEPOLIA_CHAIN_ID,
        action: input.action,
        from: ctx.account.address,
        to: getAddress(input.to),
        value_wei,
        value_display: input.value,
        data: input.data,
        created_at: now,
        expires_at: now + input.ttl_seconds * 1000,
        note: input.note,
      };

      const record = ctx.intentStore.create(intent);
      const report = await dynamicValidate(record.intent, ctx.publicClient);
      const summary = humanize(record.intent, report);
      const policy = ctx.policyEngine.evaluate(record.intent, report);
      const updated = ctx.intentStore.setPolicyEvaluation(
        record.intent.intent_id,
        policy,
        snapshotValidationReport(report),
      );

      if (!updated) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: "intent_not_found_or_expired",
                  intent_id: record.intent.intent_id,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      if (updated.status === "pending_approval") {
        ctx.approvalQueue.enqueue(updated.intent.intent_id);
      } else {
        ctx.approvalQueue.dequeue(updated.intent.intent_id);
      }

      const payload = {
        intent_id: updated.intent.intent_id,
        request_id: updated.intent.request_id,
        intent: {
          chain_id: updated.intent.chain_id,
          action: updated.intent.action,
          from: updated.intent.from,
          to: updated.intent.to,
          value_wei: updated.intent.value_wei.toString(),
          value_display: updated.intent.value_display,
          data: updated.intent.data,
          created_at: updated.intent.created_at,
          expires_at: updated.intent.expires_at,
          note: updated.intent.note,
        },
        validation: {
          ok: report.ok,
          checks: report.checks,
          balance_wei: report.balance_wei?.toString(),
          estimated_gas: report.estimated_gas?.toString(),
          estimated_fee_wei: report.estimated_fee_wei?.toString(),
          total_cost_wei: report.total_cost_wei?.toString(),
        },
        status: updated.status,
        status_reason: updated.status_reason,
        policy: updated.policy,
        queued_for_approval: ctx.approvalQueue.has(updated.intent.intent_id),
        human_summary: summary,
      };

      return {
        isError: !report.ok || updated.status === "rejected",
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    },
  );
}
