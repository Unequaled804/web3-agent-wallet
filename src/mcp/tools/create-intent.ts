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

export function registerCreateIntent(server: McpServer, ctx: WalletContext) {
  server.tool(
    "wallet_create_intent",
    [
      "Propose a structured transaction Intent. The wallet validates it (address",
      "checksum, balance, fee) but does NOT sign or broadcast. Returns an",
      "intent_id that later tools (simulate_intent, execute_intent) reference.",
      "Always read back the human_summary and confirm with the user before",
      "calling execute_intent for non-trivial amounts.",
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

      const stored = ctx.intentStore.create(intent);
      const report = await dynamicValidate(stored, ctx.publicClient);
      const summary = humanize(stored, report);

      const payload = {
        intent_id: stored.intent_id,
        request_id: stored.request_id,
        intent: {
          chain_id: stored.chain_id,
          action: stored.action,
          from: stored.from,
          to: stored.to,
          value_wei: stored.value_wei.toString(),
          value_display: stored.value_display,
          data: stored.data,
          created_at: stored.created_at,
          expires_at: stored.expires_at,
          note: stored.note,
        },
        validation: {
          ok: report.ok,
          checks: report.checks,
          balance_wei: report.balance_wei?.toString(),
          estimated_gas: report.estimated_gas?.toString(),
          estimated_fee_wei: report.estimated_fee_wei?.toString(),
          total_cost_wei: report.total_cost_wei?.toString(),
        },
        human_summary: summary,
      };

      return {
        isError: !report.ok,
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    },
  );
}
