import { expect, test } from "bun:test";

test("keeps the public stdio server entrypoint present", () => {
  expect(
    Bun.file(new URL("../src/index.ts", import.meta.url)).size,
  ).toBeGreaterThan(0);
});
