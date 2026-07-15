import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "brings-mcp", version: "0.1.0" });
server.tool(
  "brings_inspect_document",
  "Inspect a local Brings document without modifying it.",
  { path: z.string().min(1) },
  async ({ path }) => {
    const document = (await Bun.file(path).json()) as {
      id?: string;
      name?: string;
      pages?: unknown[];
      nodes?: unknown[];
    };
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            id: document.id,
            name: document.name,
            pages: document.pages?.length ?? 0,
            nodes: document.nodes?.length ?? 0,
          }),
        },
      ],
    };
  },
);
await server.connect(new StdioServerTransport());
