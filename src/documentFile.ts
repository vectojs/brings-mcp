import {
  openDocumentStore,
  validateDocument,
  type BringsDocument,
  type DocumentCommandInput,
} from "@vectojs/brings-core";
import { constants, type Stats } from "node:fs";
import {
  lstat,
  open,
  readFile,
  rename,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { hostname } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type {
  AutomationFailure,
  AutomationOperation,
  AutomationResult,
  AutomationSuccess,
} from "./schemas";

export type DocumentFileStage =
  | "before-write"
  | "before-rename"
  | "release-before-commit"
  | "release-after-commit";

export type DocumentFileDependencies = Readonly<{
  onStage?: (stage: DocumentFileStage) => void | Promise<void>;
}>;

export type MutationRequest = Readonly<{
  path: string;
  expectedRevision: number;
  dryRun: boolean;
  operation: AutomationOperation;
  command:
    DocumentCommandInput | ((document: BringsDocument) => DocumentCommandInput);
  explicitTargetIds: readonly string[];
  generatedNodeIds: readonly string[];
}>;

export type InspectionSummary = Readonly<{
  id: string;
  name: string;
  revision: number;
  pages: number;
  nodes: number;
}>;

export type InspectionResult =
  | Readonly<{ ok: true; value: InspectionSummary }>
  | Readonly<{ ok: false; error: Readonly<{ code: string; path: string }> }>;

type LockOwner = Readonly<{
  version: 1;
  token: string;
  pid: number;
  hostname: string;
  startedAt: string;
}>;

type VerifiedDocument = Readonly<{
  document: BringsDocument;
  mode: number;
}>;

class DocumentFileError extends Error {
  constructor(
    readonly code: string,
    readonly pointer: string = "/file",
  ) {
    super(code);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function fileFailure(
  request: MutationRequest,
  code: string,
  path = "/file",
  actual: number | null = null,
): AutomationFailure {
  return {
    ok: false,
    operation: request.operation,
    file: request.path,
    error: { code, path },
    revision: { expected: request.expectedRevision, actual },
    warnings: [],
  };
}

function isSafeRegularFile(stats: Stats): boolean {
  return stats.isFile() && stats.nlink === 1;
}

async function readVerifiedDocument(path: string): Promise<VerifiedDocument> {
  let pathStats: Stats;
  try {
    pathStats = await lstat(path);
  } catch (error) {
    throw new DocumentFileError(
      isNodeError(error) && error.code === "ENOENT"
        ? "document.not-found"
        : "document.read-failed",
    );
  }
  if (!isSafeRegularFile(pathStats)) {
    throw new DocumentFileError("document.file-kind");
  }

  let handle: FileHandle | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const handleStats = await handle.stat();
    if (
      !isSafeRegularFile(handleStats) ||
      handleStats.dev !== pathStats.dev ||
      handleStats.ino !== pathStats.ino
    ) {
      throw new DocumentFileError("document.file-kind");
    }
    const bytes = await handle.readFile({ encoding: "utf8" });
    let input: unknown;
    try {
      input = JSON.parse(bytes);
    } catch {
      throw new DocumentFileError("document.invalid-json");
    }
    const validated = validateDocument(input);
    if (!validated.ok) {
      throw new DocumentFileError(validated.error.code, validated.error.path);
    }
    return { document: validated.value, mode: pathStats.mode & 0o7777 };
  } catch (error) {
    if (error instanceof DocumentFileError) throw error;
    if (isNodeError(error) && ["ELOOP", "EMLINK"].includes(error.code ?? "")) {
      throw new DocumentFileError("document.file-kind");
    }
    throw new DocumentFileError("document.read-failed");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function acquireLock(lockPath: string): Promise<LockOwner> {
  const owner: LockOwner = {
    version: 1,
    token: crypto.randomUUID(),
    pid: process.pid,
    hostname: hostname(),
    startedAt: new Date().toISOString(),
  };
  let handle: FileHandle | undefined;
  try {
    handle = await open(lockPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(owner)}\n`, "utf8");
    await handle.sync();
    return owner;
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      throw new DocumentFileError("document.locked");
    }
    if (handle !== undefined) {
      const owned = await handle.stat().catch(() => undefined);
      await handle.close().catch(() => undefined);
      const current = await lstat(lockPath).catch(() => undefined);
      if (
        owned !== undefined &&
        current !== undefined &&
        owned.dev === current.dev &&
        owned.ino === current.ino
      ) {
        await unlink(lockPath).catch(() => undefined);
      }
      handle = undefined;
    }
    throw new DocumentFileError("document.lock-failed");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function releaseOwnedLock(
  lockPath: string,
  owner: LockOwner,
): Promise<void> {
  let current: unknown;
  try {
    current = JSON.parse(await readFile(lockPath, "utf8"));
  } catch {
    throw new DocumentFileError("document.lock-release-failed");
  }
  if (
    typeof current !== "object" ||
    current === null ||
    !("token" in current) ||
    current.token !== owner.token
  ) {
    throw new DocumentFileError("document.lock-release-failed");
  }
  try {
    await unlink(lockPath);
  } catch {
    throw new DocumentFileError("document.lock-release-failed");
  }
}

async function writeAtomicReplacement(
  path: string,
  document: BringsDocument,
  mode: number,
  dependencies: DocumentFileDependencies,
): Promise<void> {
  const temporaryPath = join(
    dirname(path),
    `.${basename(path)}.brings-tmp-${crypto.randomUUID()}`,
  );
  let handle: FileHandle | undefined;
  try {
    await dependencies.onStage?.("before-write");
    handle = await open(temporaryPath, "wx", mode);
    await handle.writeFile(`${JSON.stringify(document, null, 2)}\n`, "utf8");
    await handle.chmod(mode);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await dependencies.onStage?.("before-rename");
    await rename(temporaryPath, path);
  } catch (error) {
    if (error instanceof DocumentFileError) throw error;
    throw new DocumentFileError(
      error instanceof Error && error.message.includes("before-rename")
        ? "document.rename-failed"
        : "document.write-failed",
    );
  } finally {
    await handle?.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
  }
}

function nodeChanges(
  before: BringsDocument,
  after: BringsDocument,
  explicitTargetIds: readonly string[],
): string[] {
  const affected: string[] = [];
  const seen = new Set<string>();
  const append = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    affected.push(id);
  };
  for (const id of explicitTargetIds) append(id);

  const beforeNodes = new Map(
    before.nodes.map((node) => [node.id, JSON.stringify(node)]),
  );
  const afterNodes = new Map(
    after.nodes.map((node) => [node.id, JSON.stringify(node)]),
  );
  for (const node of after.nodes) {
    if (beforeNodes.get(node.id) !== JSON.stringify(node)) append(node.id);
  }
  for (const node of before.nodes) {
    if (!afterNodes.has(node.id)) append(node.id);
  }
  return affected;
}

function lockWarning() {
  return {
    code: "document.lock-release-failed" as const,
    path: "/file" as const,
  };
}

/** Inspect one verified local document without retaining its bytes or state. */
export async function inspectDocumentFile(
  path: string,
): Promise<InspectionResult> {
  try {
    const { document } = await readVerifiedDocument(resolve(path));
    return {
      ok: true,
      value: {
        id: document.id,
        name: document.name,
        revision: document.revision,
        pages: document.pages.length,
        nodes: document.nodes.length,
      },
    };
  } catch (error) {
    const failure =
      error instanceof DocumentFileError
        ? error
        : new DocumentFileError("document.read-failed");
    return { ok: false, error: { code: failure.code, path: failure.pointer } };
  }
}

/** Execute exactly one Core command under a sidecar lock and atomic replacement. */
export async function mutateDocumentFile(
  request: MutationRequest,
  dependencies: DocumentFileDependencies = {},
): Promise<AutomationResult> {
  const filePath = resolve(request.path);
  const lockPath = `${filePath}.brings.lock`;
  let owner: LockOwner;
  try {
    owner = await acquireLock(lockPath);
  } catch (error) {
    const failure =
      error instanceof DocumentFileError
        ? error
        : new DocumentFileError("document.lock-failed");
    return fileFailure(request, failure.code, failure.pointer);
  }

  let result: AutomationResult;
  let committed = false;
  let actualRevision: number | null = null;
  try {
    const { document: before, mode } = await readVerifiedDocument(filePath);
    actualRevision = before.revision;
    if (request.expectedRevision !== before.revision) {
      result = fileFailure(
        request,
        "document.revision-conflict",
        "/revision",
        before.revision,
      );
    } else {
      const opened = openDocumentStore(before);
      if (!opened.ok) {
        result = fileFailure(
          request,
          opened.error.code,
          opened.error.path,
          before.revision,
        );
      } else {
        const command =
          typeof request.command === "function"
            ? request.command(before)
            : request.command;
        const executed = opened.value.execute(command);
        if (!executed.ok) {
          result = fileFailure(
            request,
            executed.error.code,
            executed.error.path,
            before.revision,
          );
        } else {
          const afterValidation = validateDocument(executed.value.document);
          if (!afterValidation.ok) {
            result = fileFailure(
              request,
              afterValidation.error.code,
              afterValidation.error.path,
              before.revision,
            );
          } else {
            if (!request.dryRun) {
              await writeAtomicReplacement(
                filePath,
                afterValidation.value,
                mode,
                dependencies,
              );
              committed = true;
            }
            result = {
              ok: true,
              operation: request.operation,
              file: request.path,
              dryRun: request.dryRun,
              revision: {
                before: before.revision,
                after: afterValidation.value.revision,
              },
              affectedNodeIds: nodeChanges(
                before,
                afterValidation.value,
                request.explicitTargetIds,
              ),
              generatedNodeIds: [...request.generatedNodeIds],
              warnings: [],
              selection: {
                nodeIds: [...executed.value.selection.nodeIds],
                activeNodeId: executed.value.selection.activeNodeId,
              },
            } satisfies AutomationSuccess;
          }
        }
      }
    }
  } catch (error) {
    const failure =
      error instanceof DocumentFileError
        ? error
        : new DocumentFileError("document.operation-failed");
    result = fileFailure(
      request,
      failure.code,
      failure.pointer,
      actualRevision,
    );
  }

  try {
    await dependencies.onStage?.(
      committed ? "release-after-commit" : "release-before-commit",
    );
    await releaseOwnedLock(lockPath, owner);
  } catch {
    if (committed && result.ok) {
      result = { ...result, warnings: [...result.warnings, lockWarning()] };
    } else if (!result.ok) {
      result = { ...result, warnings: [...result.warnings, lockWarning()] };
    } else {
      result = fileFailure(
        request,
        "document.lock-release-failed",
        "/file",
        actualRevision,
      );
    }
  }

  return result;
}
