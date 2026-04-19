import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WalletContext } from "../../context.js";

const SetKillSwitchInputShape = {
  action: z.enum(["engage", "release"]),
  reason: z.string().min(1).max(300).optional(),
  actor: z.string().min(1).max(128).optional(),
} as const;

export function registerGetKillSwitch(server: McpServer, ctx: WalletContext) {
  server.tool(
    "wallet_get_kill_switch",
    "Return the current kill-switch state and policy thresholds.",
    {},
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              kill_switch: ctx.killSwitch.snapshot(),
              policy: ctx.policyEngine.getConfigSnapshot(),
            },
            null,
            2,
          ),
        },
      ],
    }),
  );
}

export function registerSetKillSwitch(server: McpServer, ctx: WalletContext) {
  server.tool(
    "wallet_set_kill_switch",
    "Engage or release the emergency kill switch. When engaged, new intents are rejected by policy.",
    SetKillSwitchInputShape,
    async ({ action, reason, actor }) => {
      const snapshot =
        action === "engage"
          ? ctx.killSwitch.engage(reason, actor)
          : ctx.killSwitch.release(actor, reason);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                kill_switch: snapshot,
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
