import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatEther, getAddress, isAddress } from "viem";
import { z } from "zod";
import type { WalletContext } from "../../context.js";

const inputShape = {
  address: z
    .string()
    .optional()
    .describe(
      "Optional EVM address to query. Defaults to the wallet's own address.",
    ),
};

export function registerGetBalance(server: McpServer, ctx: WalletContext) {
  server.tool(
    "wallet_get_balance",
    "Return the Sepolia native ETH balance for an address (defaults to this wallet).",
    inputShape,
    async ({ address }) => {
      const target = address ?? ctx.account.address;
      if (!isAddress(target)) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Invalid address: ${target}`,
            },
          ],
        };
      }
      const checksummed = getAddress(target);
      const wei = await ctx.publicClient.getBalance({ address: checksummed });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                chain: "sepolia",
                address: checksummed,
                balance_wei: wei.toString(),
                balance_eth: formatEther(wei),
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
