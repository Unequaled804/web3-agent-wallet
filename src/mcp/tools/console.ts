import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerGetConsoleUrl(server: McpServer, input: {
  enabled: boolean;
  url: string;
  instance_id: string;
}) {
  server.tool(
    "wallet_get_console_url",
    "Return the local web console URL for human interaction and configuration.",
    {},
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              instance_id: input.instance_id,
              web_console_enabled: input.enabled,
              url: input.url,
            },
            null,
            2,
          ),
        },
      ],
    }),
  );
}
