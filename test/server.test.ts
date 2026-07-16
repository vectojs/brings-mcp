import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createDocument } from "@vectojs/brings-core";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const SERVER_PATH = new URL("../src/index.ts", import.meta.url).pathname;
const TEMPORARY_ROOT = join(import.meta.dir, ".tmp-server");
const TOOL_NAMES = [
  "brings_inspect_document",
  "brings_create_frame",
  "brings_create_rectangle",
  "brings_create_text",
  "brings_set_node_properties",
  "brings_transform_nodes",
  "brings_delete_nodes",
  "brings_group_nodes",
  "brings_ungroup_node",
  "brings_move_nodes",
];

const temporaryDirectories: string[] = [];

beforeEach(async () => {
  await rm(TEMPORARY_ROOT, { recursive: true, force: true });
  await mkdir(TEMPORARY_ROOT, { recursive: true });
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createFixture(): Promise<string> {
  const directory = await mkdtemp(join(TEMPORARY_ROOT, "case-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "document.brings.json");
  const document = createDocument({
    id: "11111111-1111-4111-8111-111111111111",
    name: "MCP smoke document",
    initialPage: {
      id: "22222222-2222-4222-8222-222222222222",
      name: "Page 1",
    },
  });
  if (!document.ok) throw new Error(document.error.code);
  await writeFile(path, `${JSON.stringify(document.value, null, 2)}\n`);
  return path;
}

async function connectClient(): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["run", SERVER_PATH],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  const client = new Client({ name: "brings-mcp-test", version: "0.2.0" });
  await client.connect(transport);
  return client;
}

async function callMutation(
  client: Client,
  name: string,
  args: Record<string, unknown>,
) {
  const result = await client.callTool({ name, arguments: args });
  if (!Array.isArray(result.content)) {
    throw new Error("Expected MCP content blocks.");
  }
  const text = result.content[0] as { type: "text"; text: string } | undefined;
  expect(text?.type).toBe("text");
  if (text?.type !== "text") throw new Error("Expected JSON text content.");
  expect(JSON.parse(text.text)).toEqual(result.structuredContent);
  return result;
}

describe("Brings MCP stdio server", () => {
  test("lists the inspector and nine strict intention tools", async () => {
    const client = await connectClient();

    try {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toEqual(TOOL_NAMES);
      for (const tool of listed.tools) {
        expect(tool.inputSchema.additionalProperties).toBe(false);
        expect(tool.outputSchema).toBeDefined();
      }
    } finally {
      await client.close();
    }
  });

  test("includes validated revision in document inspection", async () => {
    const fixturePath = await createFixture();
    const client = await connectClient();

    try {
      const result = await client.callTool({
        name: "brings_inspect_document",
        arguments: { path: fixturePath },
      });
      const summary = {
        id: "11111111-1111-4111-8111-111111111111",
        name: "MCP smoke document",
        revision: 0,
        pages: 1,
        nodes: 0,
      };
      expect(result.structuredContent).toEqual(summary);
      expect(result.content).toEqual([
        { type: "text", text: JSON.stringify(summary) },
      ]);
    } finally {
      await client.close();
    }
  });

  test("executes all nine named intentions through one real stdio client", async () => {
    const path = await createFixture();
    const client = await connectClient();
    const frameId = "33333333-3333-4333-8333-333333333333";
    const rectangleId = "44444444-4444-4444-8444-444444444444";
    const textId = "55555555-5555-4555-8555-555555555555";
    const groupId = "66666666-6666-4666-8666-666666666666";
    const pageId = "22222222-2222-4222-8222-222222222222";

    try {
      const calls = [
        [
          "brings_create_frame",
          { path, expectedRevision: 0, x: 10, y: 20, id: frameId },
          "frame.create",
        ],
        [
          "brings_create_rectangle",
          { path, expectedRevision: 1, x: 40, y: 50, id: rectangleId },
          "rectangle.create",
        ],
        [
          "brings_create_text",
          {
            path,
            expectedRevision: 2,
            x: 70,
            y: 80,
            content: "Hello Brings",
            id: textId,
          },
          "text.create",
        ],
        [
          "brings_set_node_properties",
          { path, expectedRevision: 3, nodeId: rectangleId, width: 180 },
          "node.set",
        ],
        [
          "brings_transform_nodes",
          {
            path,
            expectedRevision: 4,
            nodeIds: [rectangleId],
            translateX: 12,
            translateY: -8,
          },
          "node.transform",
        ],
        [
          "brings_group_nodes",
          {
            path,
            expectedRevision: 5,
            nodeIds: [rectangleId, textId],
            id: groupId,
          },
          "node.group",
        ],
        [
          "brings_move_nodes",
          {
            path,
            expectedRevision: 6,
            nodeIds: [groupId],
            parentId: frameId,
            index: 0,
            pageId,
          },
          "layer.move",
        ],
        [
          "brings_ungroup_node",
          { path, expectedRevision: 7, nodeId: groupId },
          "node.ungroup",
        ],
        [
          "brings_delete_nodes",
          { path, expectedRevision: 8, nodeIds: [textId] },
          "node.delete",
        ],
      ] as const;

      for (let index = 0; index < calls.length; index += 1) {
        const [name, args, operation] = calls[index]!;
        const result = await callMutation(client, name, args);
        expect(result.isError).not.toBe(true);
        expect(result.structuredContent).toMatchObject({
          ok: true,
          operation,
          file: path,
          dryRun: false,
          revision: { before: index, after: index + 1 },
          warnings: [],
        });
      }

      const inspected = await client.callTool({
        name: "brings_inspect_document",
        arguments: { path },
      });
      expect(inspected.structuredContent).toMatchObject({
        revision: 9,
        nodes: 2,
      });
    } finally {
      await client.close();
    }
  });

  test("returns structured failures and preserves bytes for stale revisions", async () => {
    const path = await createFixture();
    const before = await readFile(path);
    const client = await connectClient();

    try {
      const result = await callMutation(client, "brings_create_frame", {
        path,
        expectedRevision: 4,
        x: 0,
        y: 0,
      });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        ok: false,
        error: { code: "document.revision-conflict", path: "/revision" },
        revision: { expected: 4, actual: 0 },
      });
      expect(await readFile(path)).toEqual(before);
    } finally {
      await client.close();
    }
  });

  test("rejects unknown fields, unsafe revisions, and symbolic colors", async () => {
    const path = await createFixture();
    const client = await connectClient();

    try {
      for (const argumentsValue of [
        { path, expectedRevision: 0, x: 0, y: 0, unknown: true },
        { path, expectedRevision: Number.MAX_SAFE_INTEGER + 1, x: 0, y: 0 },
      ]) {
        const result = await client.callTool({
          name: "brings_create_frame",
          arguments: argumentsValue,
        });
        expect(result.isError).toBe(true);
        expect(
          Array.isArray(result.content) ? result.content[0] : undefined,
        ).toMatchObject({
          type: "text",
        });
      }
      const symbolic = await client.callTool({
        name: "brings_set_node_properties",
        arguments: {
          path,
          expectedRevision: 0,
          nodeId: "33333333-3333-4333-8333-333333333333",
          fill: "red",
        },
      });
      expect(symbolic.isError).toBe(true);
    } finally {
      await client.close();
    }
  });

  test("prevents two stdio clients from committing the same revision", async () => {
    const path = await createFixture();
    const first = await connectClient();
    const second = await connectClient();

    try {
      const results = await Promise.all([
        callMutation(first, "brings_create_frame", {
          path,
          expectedRevision: 0,
          x: 0,
          y: 0,
          id: "33333333-3333-4333-8333-333333333333",
        }),
        callMutation(second, "brings_create_rectangle", {
          path,
          expectedRevision: 0,
          x: 0,
          y: 0,
          id: "44444444-4444-4444-8444-444444444444",
        }),
      ]);
      expect(results.filter((result) => result.isError !== true)).toHaveLength(
        1,
      );
      expect(results.filter((result) => result.isError === true)).toHaveLength(
        1,
      );
      const failed = results.find((result) => result.isError === true);
      expect(failed).toBeDefined();
      const failure = failed?.structuredContent as
        { error: { code: string } } | undefined;
      expect(failure?.error.code).toMatch(
        /document\.(locked|revision-conflict)/,
      );
      const document = JSON.parse(await readFile(path, "utf8")) as {
        revision: number;
      };
      expect(document.revision).toBe(1);
    } finally {
      await Promise.all([first.close(), second.close()]);
    }
  });
});
