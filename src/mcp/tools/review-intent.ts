import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WalletContext } from "../../context.js";

const ReviewIntentInputShape = {
  intent_id: z.string().min(1),
  decision: z.enum(["approve", "reject"]),
  reviewer: z.string().min(1).max(128).optional(),
  reason: z.string().min(1).max(500).optional(),
} as const;

export function registerReviewIntent(server: McpServer, ctx: WalletContext) {
  server.tool(
    "wallet_review_intent",
    "Approve or reject a pending intent in the human approval queue.",
    ReviewIntentInputShape,
    async ({ intent_id, decision, reviewer, reason }) => {
      if (decision === "approve" && ctx.killSwitch.isEnabled()) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: "kill_switch_engaged_cannot_approve",
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

      const applied = ctx.intentStore.applyManualDecision({
        intent_id,
        decision: decision === "approve" ? "approved" : "rejected",
        reviewer,
        reason,
      });

      if (!applied.ok) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: applied.error,
                  intent_id,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      ctx.approvalQueue.dequeue(intent_id);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                intent_id,
                status: applied.record.status,
                status_reason: applied.record.status_reason,
                review: applied.record.review,
                queued: ctx.approvalQueue.has(intent_id),
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
