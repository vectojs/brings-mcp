import { z } from "zod";

export const operationSchema = z.enum([
  "frame.create",
  "rectangle.create",
  "text.create",
  "node.set",
  "node.transform",
  "node.delete",
  "node.group",
  "node.ungroup",
  "layer.move",
]);

const uuidSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
const revisionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const finiteNumberSchema = z.number().refine(Number.isFinite);
const nonNegativeNumberSchema = finiteNumberSchema.min(0);
const positiveNumberSchema = finiteNumberSchema.positive();
const paintSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/)
  .nullable();

const mutationFields = {
  path: z.string().min(1),
  expectedRevision: revisionSchema,
  dryRun: z.boolean().optional().default(false),
} as const;

const creationFields = {
  ...mutationFields,
  x: finiteNumberSchema,
  y: finiteNumberSchema,
  pageId: uuidSchema.optional(),
  parentId: uuidSchema.nullable().optional(),
  index: z.number().int().min(0).optional(),
  id: uuidSchema.optional(),
} as const;

export const inspectInputSchema = z.strictObject({ path: z.string().min(1) });

export const createFrameInputSchema = z.strictObject({
  ...creationFields,
  width: positiveNumberSchema.optional(),
  height: positiveNumberSchema.optional(),
});

export const createRectangleInputSchema = z.strictObject({
  ...creationFields,
  width: positiveNumberSchema.optional(),
  height: positiveNumberSchema.optional(),
});

export const createTextInputSchema = z.strictObject({
  ...creationFields,
  content: z.string(),
});

export const setNodePropertiesInputSchema = z
  .strictObject({
    ...mutationFields,
    nodeId: uuidSchema,
    name: z.string().optional(),
    visible: z.boolean().optional(),
    locked: z.boolean().optional(),
    opacity: finiteNumberSchema.min(0).max(1).optional(),
    width: positiveNumberSchema.optional(),
    height: positiveNumberSchema.optional(),
    cornerRadii: z
      .tuple([
        nonNegativeNumberSchema,
        nonNegativeNumberSchema,
        nonNegativeNumberSchema,
        nonNegativeNumberSchema,
      ])
      .optional(),
    fill: paintSchema.optional(),
    background: paintSchema.optional(),
    strokeColor: paintSchema.optional(),
    strokeWidth: nonNegativeNumberSchema.optional(),
    clipChildren: z.boolean().optional(),
    content: z.string().optional(),
    fontFamilies: z.array(z.string().min(1)).min(1).optional(),
    fontWeight: z
      .number()
      .int()
      .refine((value) => value >= 100 && value <= 900 && value % 100 === 0)
      .optional(),
    fontSize: positiveNumberSchema.optional(),
    lineHeight: positiveNumberSchema.optional(),
    horizontalAlign: z.enum(["left", "center", "right"]).optional(),
    layoutMode: z.enum(["fixedBox", "autoWidth"]).optional(),
  })
  .superRefine((value, context) => {
    const patchKeys = Object.keys(value).filter(
      (key) => !["path", "expectedRevision", "dryRun", "nodeId"].includes(key),
    );
    if (patchKeys.length === 0) {
      context.addIssue({
        code: "custom",
        message: "A property patch is required.",
      });
    }
    if (
      (value.strokeColor === undefined) !==
      (value.strokeWidth === undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "strokeColor and strokeWidth must be supplied together.",
      });
    }
  });

export const transformNodesInputSchema = z
  .strictObject({
    ...mutationFields,
    nodeIds: z.array(uuidSchema).min(1),
    translateX: finiteNumberSchema.optional(),
    translateY: finiteNumberSchema.optional(),
    scaleX: finiteNumberSchema.optional(),
    scaleY: finiteNumberSchema.optional(),
    originX: finiteNumberSchema.optional(),
    originY: finiteNumberSchema.optional(),
  })
  .superRefine((value, context) => {
    const translationComplete =
      value.translateX !== undefined && value.translateY !== undefined;
    const translationAbsent =
      value.translateX === undefined && value.translateY === undefined;
    if (!translationComplete && !translationAbsent) {
      context.addIssue({
        code: "custom",
        message: "translateX and translateY must be supplied together.",
      });
    }
    const scaleValues = [
      value.scaleX,
      value.scaleY,
      value.originX,
      value.originY,
    ];
    const scalingComplete = scaleValues.every(
      (candidate) => candidate !== undefined,
    );
    const scalingAbsent = scaleValues.every(
      (candidate) => candidate === undefined,
    );
    if (!scalingComplete && !scalingAbsent) {
      context.addIssue({
        code: "custom",
        message:
          "scaleX, scaleY, originX, and originY must be supplied together.",
      });
    }
    if (scalingAbsent && !translationComplete) {
      context.addIssue({ code: "custom", message: "A transform is required." });
    }
  });

export const deleteNodesInputSchema = z.strictObject({
  ...mutationFields,
  nodeIds: z.array(uuidSchema).min(1),
});

export const groupNodesInputSchema = z.strictObject({
  ...mutationFields,
  nodeIds: z.array(uuidSchema).min(2),
  id: uuidSchema.optional(),
});

export const ungroupNodeInputSchema = z.strictObject({
  ...mutationFields,
  nodeId: uuidSchema,
});

export const moveNodesInputSchema = z.strictObject({
  ...mutationFields,
  nodeIds: z.array(uuidSchema).min(1),
  parentId: uuidSchema.nullable(),
  index: z.number().int().min(0),
  pageId: uuidSchema.optional(),
});

export const warningSchema = z.strictObject({
  code: z.literal("document.lock-release-failed"),
  path: z.literal("/file"),
});

const selectionSchema = z.strictObject({
  nodeIds: z.array(z.string()),
  activeNodeId: z.string().nullable(),
});

export const automationSuccessSchema = z.strictObject({
  ok: z.literal(true),
  operation: operationSchema,
  file: z.string(),
  dryRun: z.boolean(),
  revision: z.strictObject({ before: revisionSchema, after: revisionSchema }),
  affectedNodeIds: z.array(z.string()),
  generatedNodeIds: z.array(z.string()),
  warnings: z.array(warningSchema),
  selection: selectionSchema,
});

export const automationFailureSchema = z.strictObject({
  ok: z.literal(false),
  operation: operationSchema,
  file: z.string(),
  error: z.strictObject({ code: z.string(), path: z.string() }),
  revision: z.strictObject({
    expected: revisionSchema.nullable(),
    actual: revisionSchema.nullable(),
  }),
  warnings: z.array(warningSchema),
});

export const automationResultSchema = z.discriminatedUnion("ok", [
  automationSuccessSchema,
  automationFailureSchema,
]);

// The MCP SDK accepts a raw object shape for declared tool output. Runtime
// parsing below still enforces the stricter discriminated envelope contract.
export const automationOutputShape = {
  ok: z.boolean(),
  operation: operationSchema,
  file: z.string(),
  dryRun: z.boolean().optional(),
  revision: z.union([
    z.strictObject({ before: revisionSchema, after: revisionSchema }),
    z.strictObject({
      expected: revisionSchema.nullable(),
      actual: revisionSchema.nullable(),
    }),
  ]),
  affectedNodeIds: z.array(z.string()).optional(),
  generatedNodeIds: z.array(z.string()).optional(),
  warnings: z.array(warningSchema),
  selection: selectionSchema.optional(),
  error: z.strictObject({ code: z.string(), path: z.string() }).optional(),
} as const;

export const inspectOutputSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  revision: revisionSchema,
  pages: z.number().int().min(0),
  nodes: z.number().int().min(0),
});

export type AutomationOperation = z.infer<typeof operationSchema>;
export type AutomationSuccess = z.infer<typeof automationSuccessSchema>;
export type AutomationFailure = z.infer<typeof automationFailureSchema>;
export type AutomationResult = z.infer<typeof automationResultSchema>;
