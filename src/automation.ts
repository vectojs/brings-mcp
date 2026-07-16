import type {
  BringsDocument,
  DocumentCommandInput,
  NodePropertyPatchInput,
  StrokeInput,
} from "@vectojs/brings-core";
import { mutateDocumentFile } from "./documentFile";
import { parsePaint } from "./paint";
import {
  createFrameInputSchema,
  createRectangleInputSchema,
  createTextInputSchema,
  deleteNodesInputSchema,
  groupNodesInputSchema,
  moveNodesInputSchema,
  setNodePropertiesInputSchema,
  transformNodesInputSchema,
  ungroupNodeInputSchema,
  type AutomationResult,
} from "./schemas";
import type { z } from "zod";

type FrameInput = z.infer<typeof createFrameInputSchema>;
type RectangleInput = z.infer<typeof createRectangleInputSchema>;
type TextInput = z.infer<typeof createTextInputSchema>;
type SetInput = z.infer<typeof setNodePropertiesInputSchema>;
type TransformInput = z.infer<typeof transformNodesInputSchema>;
type DeleteInput = z.infer<typeof deleteNodesInputSchema>;
type GroupInput = z.infer<typeof groupNodesInputSchema>;
type UngroupInput = z.infer<typeof ungroupNodeInputSchema>;
type MoveInput = z.infer<typeof moveNodesInputSchema>;

function destination(
  document: BringsDocument,
  input: {
    pageId?: string;
    parentId?: string | null;
    index?: number;
  },
): { pageId: string; parentId: string | null; index: number } {
  const pageId = input.pageId ?? document.activePageId;
  const parentId = input.parentId ?? null;
  if (input.index !== undefined)
    return { pageId, parentId, index: input.index };
  if (parentId === null) {
    const page = document.pages.find((candidate) => candidate.id === pageId);
    return { pageId, parentId, index: page?.rootNodeIds.length ?? 0 };
  }
  const parent = document.nodes.find((node) => node.id === parentId);
  const childCount =
    parent?.type === "frame" || parent?.type === "group"
      ? parent.childIds.length
      : 0;
  return { pageId, parentId, index: childCount };
}

function commonMutation(input: {
  path: string;
  expectedRevision: number;
  dryRun: boolean;
}) {
  return {
    path: input.path,
    expectedRevision: input.expectedRevision,
    dryRun: input.dryRun,
  };
}

export function createFrame(input: FrameInput): Promise<AutomationResult> {
  const id = input.id ?? crypto.randomUUID();
  return mutateDocumentFile({
    ...commonMutation(input),
    operation: "frame.create",
    command(document): DocumentCommandInput {
      const target = destination(document, input);
      return {
        kind: "create-frame",
        ...target,
        frame: {
          id,
          name: "Frame",
          visible: true,
          locked: false,
          opacity: 1,
          transform: [1, 0, 0, 1, input.x, input.y],
          width: input.width ?? 400,
          height: input.height ?? 300,
          cornerRadii: [0, 0, 0, 0],
          background: parsePaint("#ffffffff"),
          stroke: { paint: parsePaint("#ccd6e6ff"), width: 1 },
          clipChildren: false,
        },
      };
    },
    explicitTargetIds: [id],
    generatedNodeIds: input.id === undefined ? [id] : [],
  });
}

export function createRectangle(
  input: RectangleInput,
): Promise<AutomationResult> {
  const id = input.id ?? crypto.randomUUID();
  return mutateDocumentFile({
    ...commonMutation(input),
    operation: "rectangle.create",
    command(document): DocumentCommandInput {
      const target = destination(document, input);
      return {
        kind: "create-rectangle",
        ...target,
        rectangle: {
          id,
          name: "Rectangle",
          visible: true,
          locked: false,
          opacity: 1,
          transform: [1, 0, 0, 1, input.x, input.y],
          width: input.width ?? 120,
          height: input.height ?? 80,
          cornerRadii: [8, 8, 8, 8],
          fill: parsePaint("#2e73f2ff"),
          stroke: null,
        },
      };
    },
    explicitTargetIds: [id],
    generatedNodeIds: input.id === undefined ? [id] : [],
  });
}

export function createText(input: TextInput): Promise<AutomationResult> {
  const id = input.id ?? crypto.randomUUID();
  return mutateDocumentFile({
    ...commonMutation(input),
    operation: "text.create",
    command(document): DocumentCommandInput {
      const target = destination(document, input);
      return {
        kind: "create-text",
        ...target,
        text: {
          id,
          name: "Text",
          visible: true,
          locked: false,
          opacity: 1,
          transform: [1, 0, 0, 1, input.x, input.y],
          content: input.content,
          fontFamilies: ["Inter"],
          fontWeight: 400,
          fontSize: 16,
          lineHeight: 24,
          horizontalAlign: "left",
          layoutMode: "autoWidth",
          width: 160,
          height: 24,
          fill: parsePaint("#121721ff"),
        },
      };
    },
    explicitTargetIds: [id],
    generatedNodeIds: input.id === undefined ? [id] : [],
  });
}

function stroke(input: SetInput): StrokeInput | null | undefined {
  if (input.strokeColor === undefined) return undefined;
  if (input.strokeColor === null) return null;
  return { paint: parsePaint(input.strokeColor), width: input.strokeWidth! };
}

function propertyPatch(input: SetInput): NodePropertyPatchInput {
  const patch: Record<string, unknown> = {};
  for (const key of [
    "name",
    "visible",
    "locked",
    "opacity",
    "width",
    "height",
    "cornerRadii",
    "clipChildren",
    "content",
    "fontFamilies",
    "fontWeight",
    "fontSize",
    "lineHeight",
    "horizontalAlign",
    "layoutMode",
  ] as const) {
    if (input[key] !== undefined) patch[key] = input[key];
  }
  if (input.fill !== undefined) {
    patch.fill = input.fill === null ? null : parsePaint(input.fill);
  }
  if (input.background !== undefined) {
    patch.background =
      input.background === null ? null : parsePaint(input.background);
  }
  const parsedStroke = stroke(input);
  if (parsedStroke !== undefined) patch.stroke = parsedStroke;
  return patch as NodePropertyPatchInput;
}

export function setNodeProperties(input: SetInput): Promise<AutomationResult> {
  return mutateDocumentFile({
    ...commonMutation(input),
    operation: "node.set",
    command: {
      kind: "set-node-properties",
      nodeIds: [input.nodeId],
      patch: propertyPatch(input),
    },
    explicitTargetIds: [input.nodeId],
    generatedNodeIds: [],
  });
}

export function transformNodes(
  input: TransformInput,
): Promise<AutomationResult> {
  const translateX = input.translateX ?? 0;
  const translateY = input.translateY ?? 0;
  const delta: readonly number[] =
    input.scaleX === undefined
      ? [1, 0, 0, 1, translateX, translateY]
      : [
          input.scaleX,
          0,
          0,
          input.scaleY!,
          input.originX! * (1 - input.scaleX) + translateX,
          input.originY! * (1 - input.scaleY!) + translateY,
        ];
  return mutateDocumentFile({
    ...commonMutation(input),
    operation: "node.transform",
    command: {
      kind: "apply-transform-delta",
      nodeIds: input.nodeIds,
      delta,
    },
    explicitTargetIds: input.nodeIds,
    generatedNodeIds: [],
  });
}

export function deleteNodes(input: DeleteInput): Promise<AutomationResult> {
  return mutateDocumentFile({
    ...commonMutation(input),
    operation: "node.delete",
    command: { kind: "delete-nodes", nodeIds: input.nodeIds },
    explicitTargetIds: input.nodeIds,
    generatedNodeIds: [],
  });
}

export function groupNodes(input: GroupInput): Promise<AutomationResult> {
  const id = input.id ?? crypto.randomUUID();
  return mutateDocumentFile({
    ...commonMutation(input),
    operation: "node.group",
    command: {
      kind: "group-nodes",
      nodeIds: input.nodeIds,
      group: { id, name: "Group" },
    },
    explicitTargetIds: input.nodeIds,
    generatedNodeIds: input.id === undefined ? [id] : [],
  });
}

export function ungroupNode(input: UngroupInput): Promise<AutomationResult> {
  return mutateDocumentFile({
    ...commonMutation(input),
    operation: "node.ungroup",
    command: { kind: "ungroup-node", nodeId: input.nodeId },
    explicitTargetIds: [input.nodeId],
    generatedNodeIds: [],
  });
}

export function moveNodes(input: MoveInput): Promise<AutomationResult> {
  return mutateDocumentFile({
    ...commonMutation(input),
    operation: "layer.move",
    command(document): DocumentCommandInput {
      return {
        kind: "move-nodes",
        nodeIds: input.nodeIds,
        pageId: input.pageId ?? document.activePageId,
        parentId: input.parentId,
        index: input.index,
      };
    },
    explicitTargetIds: input.nodeIds,
    generatedNodeIds: [],
  });
}
