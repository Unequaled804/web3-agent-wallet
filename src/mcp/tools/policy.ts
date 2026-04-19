import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WalletContext } from "../../context.js";
import { getPolicyState, updatePolicy } from "../../policy/service.js";

const UpdatePolicyInputShape = {
  auto_approve_max_wei: z.string().regex(/^\d+$/).optional(),
  hard_max_wei: z.string().regex(/^\d+$/).optional(),
  allowed_to: z.array(z.string()).max(200).optional(),
  blocked_to: z.array(z.string()).max(200).optional(),
  max_tx_per_minute: z.number().int().min(1).max(10_000).nullable().optional(),
  max_tx_per_hour: z.number().int().min(1).max(100_000).nullable().optional(),
  actor: z.string().min(1).max(128).optional(),
  reason: z.string().min(1).max(500).optional(),
} as const;

export function registerGetPolicy(server: McpServer, ctx: WalletContext) {
  server.tool(
    "wallet_get_policy",
    "Get current risk policy configuration and runtime counters.",
    {},
    async () => {
      const payload = getPolicyState(ctx);
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    },
  );
}

export function registerUpdatePolicy(server: McpServer, ctx: WalletContext) {
  server.tool(
    "wallet_update_policy",
    "Update risk policy thresholds, allow/block lists, and frequency limits.",
    UpdatePolicyInputShape,
    async (input) => {
      const result = await updatePolicy(ctx, input);
      if (!result.ok) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: result.error,
                  detail: result.detail,
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
                before: result.before,
                after: result.after,
                runtime: result.runtime,
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
