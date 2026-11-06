import { createHash } from "node:crypto";
import { closeSync, constants, fsyncSync, openSync, writeSync } from "node:fs";
import { chmod, lstat, mkdir, open, readdir, realpath, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { CommandOutputChunk } from "@larness/resources";
import { isInsideRoot } from "@larness/resources";
import {
  DEPLOYMENT_ARTIFACT_MAX_BYTES,
  DEPLOYMENT_ARTIFACT_MAX_DEPTH,
  DEPLOYMENT_ARTIFACT_MAX_FILES,
  DEPLOYMENT_ARTIFACT_MAX_PATH,
  DEPLOYMENT_BUILD_LOG_MAX_BYTES,
  type DeploymentArtifactManifest,
  DeploymentArtifactManifestSchema,
} from "@larness/shared";
import { canonicalJson, sha256 } from "./canonical.js";

export type ArtifactStorageCode =
  | "OUTPUT_INVALID"
  | "LIMIT_EXCEEDED"
  | "ARTIFACT_MISSING"
  | "ARTIFACT_HASH_MISMATCH"
  | "DEPLOY_UNAVAILABLE";

export class ArtifactStorageError extends Error {
  constructor(
    readonly code: ArtifactStorageCode,
    message: string,
  ) {
    super(message);
    this.name = "ArtifactStorageError";
  }
}

export interface ArtifactLimits {
  maxBytes: number;
  maxFiles: number;
}

export interface ManifestFile {
  path: string;
  size: number;
  hash: string;
}

export interface HashedTree {
  files: ManifestFile[];
  sizeBytes: number;
  hash: string;
}

export function deploymentArtifactRoot(dataDir: string): string {
  return path.resolve(dataDir, "artifacts", "deploy");
}

export function deploymentLogRoot(dataDir: string): string {
  return path.resolve(dataDir, "logs", "deploy");
}

export function artifactDirectory(dataDir: string, artifactPath: string): string {
  const root = deploymentArtifactRoot(dataDir);
  const absolute = path.resolve(root, artifactPath);
  if (!isInsideRoot(root, absolute) || absolute === root) {
    throw new ArtifactStorageError("ARTIFACT_MISSING", "Artifact path is invalid");
  }
  return absolute;
}

export function buildLogPath(dataDir: string, buildId: string): string {
  return path.join(deploymentLogRoot(dataDir), `${buildId}.log`);
}

export function buildLogRef(buildId: string): string {
  return path.posix.join("logs", "deploy", `${buildId}.log`);
}

async function privateDirectory(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const info = await lstat(dir);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new ArtifactStorageError("DEPLOY_UNAVAILABLE", "Deployment storage is unavailable");
  }
  if ((info.mode & 0o077) !== 0) await chmod(dir, 0o700);
}

export async function ensureDeploymentStorage(dataDir: string): Promise<void> {
  await privateDirectory(path.join(dataDir, "artifacts"));
  await privateDirectory(deploymentArtifactRoot(dataDir));
  await privateDirectory(path.join(dataDir, "logs"));
  await privateDirectory(deploymentLogRoot(dataDir));
  await privateDirectory(path.join(deploymentArtifactRoot(dataDir), ".staging"));
}

function relativeManifestPath(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join("/");
}

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function hashFile(
  absolute: string,
  relative: string,
  limits: ArtifactLimits,
  used: { bytes: number; files: number },
): Promise<ManifestFile> {
  const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile()) {
      throw new ArtifactStorageError("OUTPUT_INVALID", "Build output contains a non-regular file");
    }
    if (used.bytes + info.size > limits.maxBytes) {
      throw new ArtifactStorageError("LIMIT_EXCEEDED", "Build output exceeds the artifact limit");
    }
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(64 * 1024);
    let offset = 0;
    while (offset < info.size) {
      const result = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, info.size - offset),
        offset,
      );
      if (!result.bytesRead) break;
      hash.update(buffer.subarray(0, result.bytesRead));
      offset += result.bytesRead;
    }
    if (offset !== info.size) {
      throw new ArtifactStorageError("OUTPUT_INVALID", "Build output changed while being read");
    }
    used.bytes += info.size;
    used.files += 1;
    return { path: relative, size: info.size, hash: hash.digest("hex") };
  } finally {
    await handle.close();
  }
}

async function walkFiles(
  sourceRoot: string,
  current: string,
  depth: number,
  limits: ArtifactLimits,
  used: { bytes: number; files: number },
  files: ManifestFile[],
): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true });
  entries.sort((left, right) => compareNames(left.name, right.name));
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    const relative = relativeManifestPath(sourceRoot, absolute);
    if (relative.length > DEPLOYMENT_ARTIFACT_MAX_PATH) {
      throw new ArtifactStorageError("LIMIT_EXCEEDED", "Build output path is too long");
    }
    if (depth + 1 > DEPLOYMENT_ARTIFACT_MAX_DEPTH) {
      throw new ArtifactStorageError("LIMIT_EXCEEDED", "Build output is too deeply nested");
    }
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) {
      throw new ArtifactStorageError("OUTPUT_INVALID", "Build output contains a symbolic link");
    }
    if (info.isDirectory()) {
      await walkFiles(sourceRoot, absolute, depth + 1, limits, used, files);
      continue;
    }
    if (!info.isFile()) {
      throw new ArtifactStorageError("OUTPUT_INVALID", "Build output contains a non-regular file");
    }
    if (used.files >= limits.maxFiles) {
      throw new ArtifactStorageError("LIMIT_EXCEEDED", "Build output contains too many files");
    }
    files.push(await hashFile(absolute, relative, limits, used));
  }
}

export async function hashTree(
  root: string,
  limits: ArtifactLimits = {
    maxBytes: DEPLOYMENT_ARTIFACT_MAX_BYTES,
    maxFiles: DEPLOYMENT_ARTIFACT_MAX_FILES,
  },
): Promise<HashedTree> {
  const realRoot = await realpath(root);
  const used = { bytes: 0, files: 0 };
  const files: ManifestFile[] = [];
  await walkFiles(realRoot, realRoot, 0, limits, used, files);
  files.sort((left, right) => compareNames(left.path, right.path));
  const treeHash = sha256(canonicalJson(files));
  return { files, sizeBytes: used.bytes, hash: treeHash };
}

async function copyFile(
  source: string,
  destination: string,
  relative: string,
  limits: ArtifactLimits,
  used: { bytes: number; files: number },
): Promise<ManifestFile> {
  const sourceHandle = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  let destinationHandle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    const info = await sourceHandle.stat();
    if (!info.isFile()) {
      throw new ArtifactStorageError("OUTPUT_INVALID", "Build output contains a non-regular file");
    }
    if (used.bytes + info.size > limits.maxBytes) {
      throw new ArtifactStorageError("LIMIT_EXCEEDED", "Build output exceeds the artifact limit");
    }
    destinationHandle = await open(
      destination,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o400,
    );
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(64 * 1024);
    let offset = 0;
    while (offset < info.size) {
      const result = await sourceHandle.read(
        buffer,
        0,
        Math.min(buffer.length, info.size - offset),
        offset,
      );
      if (!result.bytesRead) break;
      hash.update(buffer.subarray(0, result.bytesRead));
      await destinationHandle.write(buffer, 0, result.bytesRead);
      offset += result.bytesRead;
    }
    if (offset !== info.size) {
      throw new ArtifactStorageError("OUTPUT_INVALID", "Build output changed while being copied");
    }
    await destinationHandle.sync();
    used.bytes += info.size;
    used.files += 1;
    return { path: relative, size: info.size, hash: hash.digest("hex") };
  } finally {
    await destinationHandle?.close();
    await sourceHandle.close();
  }
}

async function copyTree(
  sourceRoot: string,
  current: string,
  destinationRoot: string,
  depth: number,
  limits: ArtifactLimits,
  used: { bytes: number; files: number },
  files: ManifestFile[],
): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true });
  entries.sort((left, right) => compareNames(left.name, right.name));
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    const relative = relativeManifestPath(sourceRoot, absolute);
    if (relative.length > DEPLOYMENT_ARTIFACT_MAX_PATH) {
      throw new ArtifactStorageError("LIMIT_EXCEEDED", "Build output path is too long");
    }
    if (depth + 1 > DEPLOYMENT_ARTIFACT_MAX_DEPTH) {
      throw new ArtifactStorageError("LIMIT_EXCEEDED", "Build output is too deeply nested");
    }
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) {
      throw new ArtifactStorageError("OUTPUT_INVALID", "Build output contains a symbolic link");
    }
    const destination = path.join(destinationRoot, ...relative.split("/"));
    if (info.isDirectory()) {
      await mkdir(destination, { mode: 0o700 });
      await copyTree(sourceRoot, absolute, destinationRoot, depth + 1, limits, used, files);
      continue;
    }
    if (!info.isFile()) {
      throw new ArtifactStorageError("OUTPUT_INVALID", "Build output contains a non-regular file");
    }
    if (used.files >= limits.maxFiles) {
      throw new ArtifactStorageError("LIMIT_EXCEEDED", "Build output contains too many files");
    }
    files.push(await copyFile(absolute, destination, relative, limits, used));
  }
}

export interface StagedArtifact {
  artifactId: string;
  targetId: string;
  directory: string;
  payloadDirectory: string;
  manifest: DeploymentArtifactManifest;
  sizeBytes: number;
  fileCount: number;
  hash: string;
}

export async function stageArtifact(input: {
  dataDir: string;
  targetId: string;
  artifactId: string;
  buildId: string;
  outputDirectory: string;
  limits?: ArtifactLimits;
}): Promise<StagedArtifact> {
  const limits = input.limits ?? {
    maxBytes: DEPLOYMENT_ARTIFACT_MAX_BYTES,
    maxFiles: DEPLOYMENT_ARTIFACT_MAX_FILES,
  };
  await ensureDeploymentStorage(input.dataDir);
  const stagingRoot = path.join(deploymentArtifactRoot(input.dataDir), ".staging");
  const stagingDirectory = path.join(stagingRoot, input.buildId);
  await rm(stagingDirectory, { recursive: true, force: true });
  await mkdir(stagingDirectory, { mode: 0o700 });
  const payloadDirectory = path.join(stagingDirectory, "payload");
  await mkdir(payloadDirectory, { mode: 0o700 });

  try {
    const sourceRoot = await realpath(input.outputDirectory);
    const sourceInfo = await stat(sourceRoot);
    if (!sourceInfo.isDirectory()) {
      throw new ArtifactStorageError("OUTPUT_INVALID", "Build output is not a directory");
    }
    const used = { bytes: 0, files: 0 };
    const files: ManifestFile[] = [];
    await copyTree(sourceRoot, sourceRoot, payloadDirectory, 0, limits, used, files);
    if (files.length === 0) {
      throw new ArtifactStorageError("OUTPUT_INVALID", "Build output is empty");
    }
    files.sort((left, right) => compareNames(left.path, right.path));
    const hash = sha256(canonicalJson(files));
    const manifest: DeploymentArtifactManifest = {
      version: 1,
      artifactId: input.artifactId as DeploymentArtifactManifest["artifactId"],
      targetId: input.targetId as DeploymentArtifactManifest["targetId"],
      hash,
      files,
    };
    const manifestFile = path.join(stagingDirectory, "artifact.json");
    const manifestHandle = await open(
      manifestFile,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o400,
    );
    try {
      await manifestHandle.writeFile(`${canonicalJson(manifest)}\n`);
      await manifestHandle.sync();
    } finally {
      await manifestHandle.close();
    }
    return {
      artifactId: input.artifactId,
      targetId: input.targetId,
      directory: stagingDirectory,
      payloadDirectory,
      manifest,
      sizeBytes: used.bytes,
      fileCount: used.files,
      hash,
    };
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true });
    throw error;
  }
}

export async function commitArtifact(dataDir: string, staged: StagedArtifact): Promise<string> {
  const root = deploymentArtifactRoot(dataDir);
  const targetDirectory = path.join(root, staged.targetId);
  await mkdir(targetDirectory, { recursive: true, mode: 0o700 });
  const destination = path.join(targetDirectory, staged.artifactId);
  await rename(staged.directory, destination);
  return path.posix.join(staged.targetId, staged.artifactId);
}

export async function removeStagedArtifact(dataDir: string, buildId: string): Promise<void> {
  await rm(path.join(deploymentArtifactRoot(dataDir), ".staging", buildId), {
    recursive: true,
    force: true,
  });
}

export interface ArtifactVerification {
  valid: boolean;
  code?: "ARTIFACT_MISSING" | "ARTIFACT_HASH_MISMATCH" | "DEPLOY_UNAVAILABLE";
}

export async function verifyStoredArtifact(input: {
  dataDir: string;
  artifactPath: string;
  artifactId: string;
  targetId: string;
  expectedHash: string;
  limits?: ArtifactLimits;
}): Promise<ArtifactVerification> {
  let directory: string;
  try {
    directory = artifactDirectory(input.dataDir, input.artifactPath);
  } catch {
    return { valid: false, code: "ARTIFACT_MISSING" };
  }
  let manifest: DeploymentArtifactManifest;
  try {
    const realRoot = await realpath(deploymentArtifactRoot(input.dataDir));
    const realDirectory = await realpath(directory);
    if (!isInsideRoot(realRoot, realDirectory) || realDirectory === realRoot) {
      return { valid: false, code: "ARTIFACT_MISSING" };
    }
    const handle = await open(
      path.join(realDirectory, "artifact.json"),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > 4 * 1024 * 1024) {
        return { valid: false, code: "ARTIFACT_HASH_MISMATCH" };
      }
      manifest = DeploymentArtifactManifestSchema.parse(JSON.parse(await handle.readFile("utf8")));
    } finally {
      await handle.close();
    }
    const tree = await hashTree(
      path.join(realDirectory, "payload"),
      input.limits ?? {
        maxBytes: DEPLOYMENT_ARTIFACT_MAX_BYTES,
        maxFiles: DEPLOYMENT_ARTIFACT_MAX_FILES,
      },
    );
    if (
      manifest.artifactId !== input.artifactId ||
      manifest.targetId !== input.targetId ||
      manifest.hash !== input.expectedHash ||
      tree.hash !== input.expectedHash ||
      canonicalJson(manifest.files) !== canonicalJson(tree.files)
    ) {
      return { valid: false, code: "ARTIFACT_HASH_MISMATCH" };
    }
    return { valid: true };
  } catch (error) {
    if (error instanceof ArtifactStorageError) {
      return {
        valid: false,
        code:
          error.code === "ARTIFACT_MISSING" || error.code === "DEPLOY_UNAVAILABLE"
            ? error.code
            : "ARTIFACT_HASH_MISMATCH",
      };
    }
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { valid: false, code: "ARTIFACT_MISSING" };
    return { valid: false, code: "DEPLOY_UNAVAILABLE" };
  }
}

export async function readDeploymentLog(dataDir: string, logRef: string): Promise<string> {
  const root = path.resolve(dataDir);
  const absolute = path.resolve(root, logRef);
  if (!isInsideRoot(root, absolute) || absolute === root) {
    throw new ArtifactStorageError("DEPLOY_UNAVAILABLE", "Deployment log path is invalid");
  }
  const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > DEPLOYMENT_BUILD_LOG_MAX_BYTES) {
      throw new ArtifactStorageError("DEPLOY_UNAVAILABLE", "Deployment log is unavailable");
    }
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

export interface BuildLog {
  append(chunk: CommandOutputChunk): void;
  close(): void;
  truncated(): boolean;
}

export async function createBuildLog(
  dataDir: string,
  buildId: string,
  maxBytes = DEPLOYMENT_BUILD_LOG_MAX_BYTES,
): Promise<BuildLog> {
  await ensureDeploymentStorage(dataDir);
  const file = buildLogPath(dataDir, buildId);
  const fd = openSync(
    file,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  let size = 0;
  let truncated = false;
  let closed = false;
  return {
    append(chunk) {
      if (closed || truncated) return;
      const prefix = chunk.channel === "stderr" ? "[stderr] " : "[stdout] ";
      let text = `${prefix}${chunk.data}`;
      if (!text.endsWith("\n")) text += "\n";
      const bytes = Buffer.from(text);
      if (size + bytes.length > maxBytes) {
        truncated = true;
        return;
      }
      let offset = 0;
      while (offset < bytes.length) {
        const written = writeSync(fd, bytes, offset);
        if (!written) throw new Error("Deployment log write failed");
        offset += written;
      }
      size += bytes.length;
    },
    close() {
      if (closed) return;
      closed = true;
      try {
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    },
    truncated() {
      return truncated;
    },
  };
}
