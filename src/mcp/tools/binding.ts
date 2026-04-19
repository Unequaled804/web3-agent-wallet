import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WalletContext } from "../../context.js";
import { bindAgent, getBindingState, unbindAgent } from "../../access/service.js";

const BindAgentInputShape = {
  agent_id: z.string().min(1).max(128),
  actor: z.string().min(1).max(128).optional(),
  reason: z.string().min(1).max(500).optional(),
} as const;

const UnbindAgentInputShape = {
  actor: z.string().min(1).max(128).optional(),
  reason: z.string().min(1).max(500).optional(),
} as const;

export function registerGetBinding(server: McpServer, ctx: WalletContext) {
  server.tool(
    "wallet_get_binding",
    "Get current wallet-agent binding state.",
    {},
    async () => {
      const payload = await getBindingState(ctx);
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      };
    },
  );
}

export function registerBindAgent(server: McpServer, ctx: WalletContext) {
  server.tool(
    "wallet_bind_agent",
    "Bind this wallet to an agent identity. After binding, wallet_create_intent and wallet_execute_intent require matching agent_id.",
    BindAgentInputShape,
    async ({ agent_id, actor, reason }) => {
      const { before, after } = await bindAgent(ctx, { agent_id, actor, reason });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                before,
                after,
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

export function registerUnbindAgent(server: McpServer, ctx: WalletContext) {
  server.tool(
    "wallet_unbind_agent",
    "Remove active wallet-agent binding.",
    UnbindAgentInputShape,
    async ({ actor, reason }) => {
      const { before, after } = await unbindAgent(ctx, { actor, reason });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                before,
                after,
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
