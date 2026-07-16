import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  createDocument,
  openDocumentStore,
  type DocumentCommandInput,
} from "@vectojs/brings-core";
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { basename, join } from "node:path";
import {
  inspectDocumentFile,
  mutateDocumentFile,
  type DocumentFileStage,
} from "../src/documentFile";

const temporaryDirectories: string[] = [];
const TEMPORARY_ROOT = join(import.meta.dir, ".tmp-document-file");

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

async function fixture(): Promise<{
  directory: string;
  path: string;
  pageId: string;
}> {
  const directory = await mkdtemp(join(TEMPORARY_ROOT, "case-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "document.brings.json");
  const pageId = "22222222-2222-4222-8222-222222222222";
  const created = createDocument({
    id: "11111111-1111-4111-8111-111111111111",
    name: "MCP transaction fixture",
    initialPage: { id: pageId, name: "Page 1" },
  });
  if (!created.ok) throw new Error(created.error.code);
  await writeFile(path, `${JSON.stringify(created.value, null, 2)}\n`);
  return { directory, path, pageId };
}

function frameCommand(pageId: string): DocumentCommandInput {
  return {
    kind: "create-frame",
    pageId,
    parentId: null,
    index: 0,
    frame: {
      id: "33333333-3333-4333-8333-333333333333",
      name: "Frame",
      visible: true,
      locked: false,
      opacity: 1,
      transform: [1, 0, 0, 1, 20, 30],
      width: 400,
      height: 300,
      cornerRadii: [0, 0, 0, 0],
      background: { type: "solid", r: 1, g: 1, b: 1, a: 1 },
      stroke: {
        paint: { type: "solid", r: 0.8, g: 0.84, b: 0.9, a: 1 },
        width: 1,
      },
      clipChildren: false,
    },
  };
}

async function mutate(
  path: string,
  pageId: string,
  options: {
    dryRun?: boolean;
    stageFault?: (stage: DocumentFileStage) => void | Promise<void>;
  } = {},
) {
  return mutateDocumentFile(
    {
      path,
      expectedRevision: 0,
      dryRun: options.dryRun ?? false,
      operation: "frame.create",
      command: frameCommand(pageId),
      explicitTargetIds: ["33333333-3333-4333-8333-333333333333"],
      generatedNodeIds: [],
    },
    { onStage: options.stageFault },
  );
}

describe("MCP document file transactions", () => {
  test("inspects only validated regular documents", async () => {
    const { path } = await fixture();
    const result = await inspectDocumentFile(path);
    expect(result).toEqual({
      ok: true,
      value: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "MCP transaction fixture",
        revision: 0,
        pages: 1,
        nodes: 0,
      },
    });
  });

  test("returns a durable success and preserves the original mode", async () => {
    const { path, pageId } = await fixture();
    await chmod(path, 0o640);
    const result = await mutate(path, pageId);
    expect(result).toMatchObject({
      ok: true,
      operation: "frame.create",
      dryRun: false,
      revision: { before: 0, after: 1 },
      affectedNodeIds: ["33333333-3333-4333-8333-333333333333"],
      warnings: [],
    });
    expect((await stat(path)).mode & 0o777).toBe(0o640);
    const opened = openDocumentStore(JSON.parse(await readFile(path, "utf8")));
    expect(opened.ok && opened.value.snapshot().document.revision).toBe(1);
  });

  test("keeps bytes unchanged for dry runs and stale revisions", async () => {
    const { path, pageId } = await fixture();
    const before = await readFile(path);
    const dryRun = await mutate(path, pageId, { dryRun: true });
    expect(dryRun).toMatchObject({
      ok: true,
      dryRun: true,
      revision: { before: 0, after: 1 },
    });
    expect(await readFile(path)).toEqual(before);

    const stale = await mutateDocumentFile({
      path,
      expectedRevision: 7,
      dryRun: false,
      operation: "frame.create",
      command: frameCommand(pageId),
      explicitTargetIds: ["33333333-3333-4333-8333-333333333333"],
      generatedNodeIds: [],
    });
    expect(stale).toMatchObject({
      ok: false,
      error: { code: "document.revision-conflict", path: "/revision" },
      revision: { expected: 7, actual: 0 },
    });
    expect(await readFile(path)).toEqual(before);
  });

  test("rejects a competing sidecar lock without changing bytes", async () => {
    const { path, pageId } = await fixture();
    const before = await readFile(path);
    const lock = await open(`${path}.brings.lock`, "wx", 0o600);
    await lock.writeFile('{"version":1,"token":"other"}\n');
    await lock.close();
    const result = await mutate(path, pageId);
    expect(result).toMatchObject({
      ok: false,
      error: { code: "document.locked", path: "/file" },
    });
    expect(await readFile(path)).toEqual(before);
  });

  test("rejects symlinks, hard links, and non-regular files", async () => {
    const { directory, path, pageId } = await fixture();
    const symlinkPath = join(directory, "symlink.json");
    await symlink(path, symlinkPath);
    expect(await mutate(symlinkPath, pageId)).toMatchObject({
      ok: false,
      error: { code: "document.file-kind", path: "/file" },
    });

    const hardLinkPath = join(directory, "hard-link.json");
    await link(path, hardLinkPath);
    expect(await mutate(path, pageId)).toMatchObject({
      ok: false,
      error: { code: "document.file-kind", path: "/file" },
    });

    const directoryPath = join(directory, "not-a-file");
    await mkdir(directoryPath);
    expect(await mutate(directoryPath, pageId)).toMatchObject({
      ok: false,
      error: { code: "document.file-kind", path: "/file" },
    });
  });

  test("write and rename faults preserve original bytes and clean temporary files", async () => {
    for (const fault of ["before-write", "before-rename"] as const) {
      const { directory, path, pageId } = await fixture();
      const before = await readFile(path);
      const result = await mutate(path, pageId, {
        stageFault(stage) {
          if (stage === fault) throw new Error(`injected ${fault}`);
        },
      });
      expect(result).toMatchObject({ ok: false, error: { path: "/file" } });
      expect(await readFile(path)).toEqual(before);
      const entries = await Array.fromAsync(new Bun.Glob("*").scan(directory));
      expect(entries).toEqual([basename(path)]);
    }
  });

  test("applies lock-release semantics at the commit boundary", async () => {
    for (const dryRun of [false, true]) {
      const { path, pageId } = await fixture();
      const before = await readFile(path);
      const result = await mutate(path, pageId, {
        dryRun,
        stageFault(stage) {
          if (
            stage ===
            (dryRun ? "release-before-commit" : "release-after-commit")
          ) {
            throw new Error("injected lock release failure");
          }
        },
      });
      if (dryRun) {
        expect(result).toMatchObject({
          ok: false,
          error: { code: "document.lock-release-failed", path: "/file" },
        });
        expect(await readFile(path)).toEqual(before);
      } else {
        expect(result).toMatchObject({
          ok: true,
          warnings: [{ code: "document.lock-release-failed", path: "/file" }],
        });
        expect(await readFile(path)).not.toEqual(before);
      }
    }
  });

  test("keeps a primary failure when lock release also fails", async () => {
    const { path, pageId } = await fixture();
    const result = await mutate(path, pageId, {
      stageFault(stage) {
        if (stage === "before-write") throw new Error("injected write failure");
        if (stage === "release-before-commit") {
          throw new Error("injected release failure");
        }
      },
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "document.write-failed", path: "/file" },
      warnings: [{ code: "document.lock-release-failed", path: "/file" }],
    });
  });
});
