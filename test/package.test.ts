import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

describe("published executable", () => {
  test("uses a direct Bun shebang and normalized npm bin target", async () => {
    const entrypoint = await readFile(
      new URL("../src/index.ts", import.meta.url),
      "utf8",
    );
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as { bin?: Record<string, string> };

    expect(entrypoint.startsWith("#!/usr/bin/env bun\n")).toBe(true);
    expect(packageJson.bin).toEqual({ "brings-mcp": "src/index.ts" });
  });
});
