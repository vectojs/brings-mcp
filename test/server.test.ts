import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("keeps the public stdio server entrypoint present", () => {
  expect(
    Bun.file(new URL("../src/index.ts", import.meta.url)).size,
  ).toBeGreaterThan(0);
});

test("serves document inspection over a real stdio MCP connection", async () => {
  const serverPath = new URL("../src/index.ts", import.meta.url).pathname;
  const fixturePath = new URL("./fixtures/document.json", import.meta.url)
    .pathname;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["run", serverPath],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  const client = new Client({ name: "brings-mcp-test", version: "0.1.0" });

  try {
    await client.connect(transport);
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toContain(
      "brings_inspect_document",
    );

    const result = await client.callTool({
      name: "brings_inspect_document",
      arguments: { path: fixturePath },
    });
    expect(result.content).toEqual([
      {
        type: "text",
        text: JSON.stringify({
          id: "11111111-1111-4111-8111-111111111111",
          name: "MCP smoke document",
          pages: 1,
          nodes: 2,
        }),
      },
    ]);
  } finally {
    await client.close();
  }
});
