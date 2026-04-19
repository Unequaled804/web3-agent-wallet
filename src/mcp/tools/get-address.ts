import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WalletContext } from "../../context.js";

export function registerGetAddress(server: McpServer, ctx: WalletContext) {
  server.tool(
    "wallet_get_address",
    "Return the wallet's EOA address on Sepolia. Safe, read-only, no side effects.",
    {},
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { chain: "sepolia", address: ctx.account.address },
            null,
            2,
          ),
        },
      ],
    }),
  );
}
