import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createFrame,
  createRectangle,
  createText,
  deleteNodes,
  groupNodes,
  moveNodes,
  setNodeProperties,
  transformNodes,
  ungroupNode,
} from "./automation";
import { inspectDocumentFile } from "./documentFile";
import {
  automationOutputShape,
  automationResultSchema,
  createFrameInputSchema,
  createRectangleInputSchema,
  createTextInputSchema,
  deleteNodesInputSchema,
  groupNodesInputSchema,
  inspectInputSchema,
  inspectOutputSchema,
  moveNodesInputSchema,
  setNodePropertiesInputSchema,
  transformNodesInputSchema,
  ungroupNodeInputSchema,
  type AutomationResult,
} from "./schemas";

function contentFor(structuredContent: Record<string, unknown>) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(structuredContent) },
    ],
    structuredContent,
  };
}

function automationContent(result: AutomationResult) {
  const validated = automationResultSchema.parse(result);
  return { ...contentFor(validated), isError: !validated.ok };
}

export function createServer(): McpServer {
  const server = new McpServer({ name: "brings-mcp", version: "0.2.0" });

  server.registerTool(
    "brings_inspect_document",
    {
      description:
        "Inspect a validated local Brings document without modifying it.",
      inputSchema: inspectInputSchema,
      outputSchema: inspectOutputSchema,
    },
    async ({ path }) => {
      const inspected = await inspectDocumentFile(path);
      if (!inspected.ok) {
        throw new Error(`${inspected.error.code} at ${inspected.error.path}`);
      }
      return contentFor(inspected.value);
    },
  );

  server.registerTool(
    "brings_create_frame",
    {
      description: "Create a Frame at parent-local coordinates.",
      inputSchema: createFrameInputSchema,
      outputSchema: automationOutputShape,
    },
    async (input) => automationContent(await createFrame(input)),
  );
  server.registerTool(
    "brings_create_rectangle",
    {
      description: "Create a Rectangle at parent-local coordinates.",
      inputSchema: createRectangleInputSchema,
      outputSchema: automationOutputShape,
    },
    async (input) => automationContent(await createRectangle(input)),
  );
  server.registerTool(
    "brings_create_text",
    {
      description: "Create Text at parent-local coordinates.",
      inputSchema: createTextInputSchema,
      outputSchema: automationOutputShape,
    },
    async (input) => automationContent(await createText(input)),
  );
  server.registerTool(
    "brings_set_node_properties",
    {
      description: "Set compatible properties on one node.",
      inputSchema: setNodePropertiesInputSchema,
      outputSchema: automationOutputShape,
    },
    async (input) => automationContent(await setNodeProperties(input)),
  );
  server.registerTool(
    "brings_transform_nodes",
    {
      description: "Apply one page-space affine transform to nodes.",
      inputSchema: transformNodesInputSchema,
      outputSchema: automationOutputShape,
    },
    async (input) => automationContent(await transformNodes(input)),
  );
  server.registerTool(
    "brings_delete_nodes",
    {
      description: "Delete nodes and their descendants.",
      inputSchema: deleteNodesInputSchema,
      outputSchema: automationOutputShape,
    },
    async (input) => automationContent(await deleteNodes(input)),
  );
  server.registerTool(
    "brings_group_nodes",
    {
      description: "Group active-page sibling nodes.",
      inputSchema: groupNodesInputSchema,
      outputSchema: automationOutputShape,
    },
    async (input) => automationContent(await groupNodes(input)),
  );
  server.registerTool(
    "brings_ungroup_node",
    {
      description: "Dissolve one Group while preserving geometry.",
      inputSchema: ungroupNodeInputSchema,
      outputSchema: automationOutputShape,
    },
    async (input) => automationContent(await ungroupNode(input)),
  );
  server.registerTool(
    "brings_move_nodes",
    {
      description:
        "Move nodes to an exact layer index while preserving page-space geometry.",
      inputSchema: moveNodesInputSchema,
      outputSchema: automationOutputShape,
    },
    async (input) => automationContent(await moveNodes(input)),
  );

  return server;
}
