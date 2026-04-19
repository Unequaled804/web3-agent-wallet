import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WalletContext } from "../../context.js";

const QueryHistoryInputShape = {
  limit: z.number().int().min(1).max(500).default(50),
  event_type: z.string().min(1).max(128).optional(),
  intent_id: z.string().min(1).optional(),
  request_id: z.string().min(1).optional(),
  address: z.string().min(1).optional(),
  status: z.string().min(1).max(64).optional(),
  tx_hash: z.string().min(1).optional(),
  from_time: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Inclusive lower bound for event timestamp (unix ms)."),
  to_time: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Inclusive upper bound for event timestamp (unix ms)."),
} as const;

export function registerQueryHistory(server: McpServer, ctx: WalletContext) {
  server.tool(
    "wallet_query_history",
    "Query persisted audit/history records (intent lifecycle, policy decisions, approvals, execution, kill-switch events).",
    QueryHistoryInputShape,
    async (input) => {
      const rows = ctx.auditStore.query(input);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                count: rows.length,
                events: rows,
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
