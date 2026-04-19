import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAddress } from "viem";
import { z } from "zod";
import type { WalletContext } from "../../context.js";

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

function normalizeAddressList(list?: string[]): string[] | undefined {
  if (list === undefined) return undefined;
  return list.map((value) => getAddress(value).toLowerCase());
}

export function registerGetPolicy(server: McpServer, ctx: WalletContext) {
  server.tool(
    "wallet_get_policy",
    "Get current risk policy configuration and runtime counters.",
    {},
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              policy: ctx.policyEngine.getConfigSnapshot(),
              runtime: ctx.policyEngine.getRuntimeSnapshot(),
            },
            null,
            2,
          ),
        },
      ],
    }),
  );
}

export function registerUpdatePolicy(server: McpServer, ctx: WalletContext) {
  server.tool(
    "wallet_update_policy",
    "Update risk policy thresholds, allow/block lists, and frequency limits.",
    UpdatePolicyInputShape,
    async (input) => {
      const before = ctx.policyEngine.getConfigSnapshot();

      let normalizedAllowed: string[] | undefined;
      let normalizedBlocked: string[] | undefined;
      try {
        normalizedAllowed = normalizeAddressList(input.allowed_to);
        normalizedBlocked = normalizeAddressList(input.blocked_to);
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: "invalid_address_list",
                  detail: error instanceof Error ? error.message : String(error),
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      try {
        const after = ctx.policyEngine.applyUpdate({
          auto_approve_max_wei: input.auto_approve_max_wei,
          hard_max_wei: input.hard_max_wei,
          allowed_to: normalizedAllowed,
          blocked_to: normalizedBlocked,
          max_tx_per_minute: input.max_tx_per_minute,
          max_tx_per_hour: input.max_tx_per_hour,
        });

        await ctx.auditStore.setSetting("policy_config", after);
        await ctx.auditStore.logEvent({
          event_type: "policy_updated",
          status: "applied",
          payload: {
            actor: input.actor,
            reason: input.reason,
            before,
            after,
            patch: {
              auto_approve_max_wei: input.auto_approve_max_wei,
              hard_max_wei: input.hard_max_wei,
              allowed_to: normalizedAllowed,
              blocked_to: normalizedBlocked,
              max_tx_per_minute: input.max_tx_per_minute,
              max_tx_per_hour: input.max_tx_per_hour,
            },
          },
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  before,
                  after,
                  runtime: ctx.policyEngine.getRuntimeSnapshot(),
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        await ctx.auditStore.logEvent({
          event_type: "policy_update_failed",
          status: "rejected",
          payload: {
            actor: input.actor,
            reason: input.reason,
            error: error instanceof Error ? error.message : String(error),
            patch: input,
          },
        });

        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: "policy_update_failed",
                  detail: error instanceof Error ? error.message : String(error),
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
