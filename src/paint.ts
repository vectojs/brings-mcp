import type { SolidPaintInput } from "@vectojs/brings-core";

/** Convert a schema-validated hexadecimal color to Core's normalized paint. */
export function parsePaint(value: string): SolidPaintInput {
  const hex = value.slice(1);
  return {
    type: "solid",
    r: Number.parseInt(hex.slice(0, 2), 16) / 255,
    g: Number.parseInt(hex.slice(2, 4), 16) / 255,
    b: Number.parseInt(hex.slice(4, 6), 16) / 255,
    a: hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1,
  };
}
