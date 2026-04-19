import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WalletContext } from "../../context.js";
import { humanize } from "../../intent/humanize.js";

const ListApprovalsInputShape = {
  limit: z.number().int().min(1).max(100).default(20),
} as const;

export function registerListApprovals(server: McpServer, ctx: WalletContext) {
  server.tool(
    "wallet_list_approvals",
    "List intents currently waiting in the human approval queue.",
    ListApprovalsInputShape,
    async ({ limit }) => {
      ctx.approvalQueue.compact((intent_id) => Boolean(ctx.intentStore.getRecord(intent_id)));

      const queue = ctx.approvalQueue
        .list()
        .slice(0, limit)
        .map((entry) => {
          const record = ctx.intentStore.getRecord(entry.intent_id);
          if (!record) return null;
          return {
            intent_id: record.intent.intent_id,
            request_id: record.intent.request_id,
            status: record.status,
            status_reason: record.status_reason,
            enqueued_at: entry.enqueued_at,
            expires_at: record.intent.expires_at,
            policy: record.policy,
            human_summary: humanize(record.intent),
          };
        })
        .filter((v): v is NonNullable<typeof v> => v !== null);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                count: queue.length,
                queue,
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
