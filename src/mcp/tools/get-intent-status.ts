import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WalletContext } from "../../context.js";

const GetIntentStatusInputShape = {
  intent_id: z.string().min(1),
} as const;

export function registerGetIntentStatus(server: McpServer, ctx: WalletContext) {
  server.tool(
    "wallet_get_intent_status",
    "Return policy/approval status for a previously created intent.",
    GetIntentStatusInputShape,
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

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                intent_id,
                request_id: record.intent.request_id,
                status: record.status,
                status_reason: record.status_reason,
                queued_for_approval: ctx.approvalQueue.has(intent_id),
                policy: record.policy,
                validation: record.validation,
                review: record.review,
                execution: record.execution,
                created_at: record.created_at,
                updated_at: record.updated_at,
                expires_at: record.intent.expires_at,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
