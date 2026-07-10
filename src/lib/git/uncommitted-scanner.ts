import "server-only";

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  readFile,
  readdir,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type {
  ChangeCounts,
  GitScanWarning,
  UncommittedProject,
} from "@/lib/git/types";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 5_000;
const GIT_MAX_BUFFER = 8 * 1024 * 1024;
const REPOSITORY_SCAN_CONCURRENCY = 4;
const FILE_STAT_CONCURRENCY = 16;
const CONFLICT_CODES = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);
const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  ".next",
  "dist",
  "build",
  "out",
  "coverage",
  ".cache",
  ".turbo",
  ".vercel",
  ".venv",
  "venv",
  "vendor",
  "target",
  ".idea",
  ".vscode",
  ".claude",
]);

export const UNCOMMITTED_ROOTS = ["C:\\Codex", "C:\\ClaudeCode"] as const;

export function getRepositoryId(directory: string): string {
  return createHash("sha256")
    .update(directory.toLowerCase())
    .digest("base64url")
    .slice(0, 20);
}

interface DiscoveryResult {
  repositories: string[];
  warnings: GitScanWarning[];
}

interface ParsedStatus {
  counts: ChangeCounts;
  paths: string[];
}

export interface UncommittedScanResult {
  projects: UncommittedProject[];
  roots: string[];
  warnings: GitScanWarning[];
}

interface GitCommandFailure extends Error {
  code?: string | number;
  killed?: boolean;
  stderr?: string;
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await operation(values[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.min(concurrency, values.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function shouldSkipDirectory(name: string): boolean {
  const normalized = name.toLowerCase();
  return name.startsWith(".") || SKIPPED_DIRECTORIES.has(normalized);
}

export async function discoverGitRepositories(
  roots: readonly string[] = UNCOMMITTED_ROOTS,
): Promise<DiscoveryResult> {
  const queue = [...roots];
  const repositories = new Map<string, string>();
  const warnings: GitScanWarning[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    let currentStats;
    try {
      currentStats = await lstat(current);
    } catch (error) {
      warnings.push({
        directory: current,
        message: isMissingFileError(error)
          ? "Directory does not exist."
          : "Directory could not be inspected.",
      });
      continue;
    }

    if (!currentStats.isDirectory() || currentStats.isSymbolicLink()) {
      continue;
    }

    try {
      const gitMarker = await lstat(path.join(current, ".git"));
      if (gitMarker.isDirectory() || gitMarker.isFile()) {
        repositories.set(current.toLowerCase(), current);
        continue;
      }
    } catch (error) {
      if (!isMissingFileError(error)) {
        warnings.push({
          directory: current,
          message: "Git metadata could not be inspected.",
        });
        continue;
      }
    }

    try {
      const entries = await readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        if (
          !entry.isDirectory() ||
          entry.isSymbolicLink() ||
          shouldSkipDirectory(entry.name)
        ) {
          continue;
        }
        queue.push(path.join(current, entry.name));
      }
    } catch {
      warnings.push({
        directory: current,
        message: "Directory contents could not be read.",
      });
    }
  }

  return {
    repositories: [...repositories.values()].sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: "base" }),
    ),
    warnings,
  };
}

export function parsePorcelainStatus(output: string): ParsedStatus {
  const counts: ChangeCounts = {
    total: 0,
    staged: 0,
    modified: 0,
    untracked: 0,
    conflicted: 0,
  };
  const paths: string[] = [];
  const records = output.split("\0").filter(Boolean);

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.length < 3) {
      continue;
    }

    const code = record.slice(0, 2);
    const changedPath = record.slice(3);
    counts.total += 1;
    paths.push(changedPath);

    if (code === "??") {
      counts.untracked += 1;
      continue;
    }

    if (CONFLICT_CODES.has(code)) {
      counts.conflicted += 1;
    } else {
      if (code[0] !== " ") counts.staged += 1;
      if (code[1] !== " ") counts.modified += 1;
    }

    if ((code.includes("R") || code.includes("C")) && records[index + 1]) {
      paths.push(records[index + 1]);
      index += 1;
    }
  }

  return { counts, paths };
}

async function runGit(repository: string, argumentsList: string[]): Promise<string> {
  const { stdout } = await execFileAsync(
    "git.exe",
    ["-C", repository, ...argumentsList],
    {
      encoding: "utf8",
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      maxBuffer: GIT_MAX_BUFFER,
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
    },
  );
  return stdout;
}

async function tryGit(
  repository: string,
  argumentsList: string[],
): Promise<string | null> {
  try {
    return (await runGit(repository, argumentsList)).trim();
  } catch {
    return null;
  }
}

function formatGitError(error: unknown): string {
  const failure = error as GitCommandFailure;
  if (failure.killed || failure.code === "ETIMEDOUT") {
    return "Git status timed out after five seconds.";
  }

  const details = failure.stderr?.trim().split(/\r?\n/, 1)[0];
  return details || "Git status could not be read.";
}

async function getProjectName(repository: string): Promise<string> {
  try {
    const packageJson = JSON.parse(
      await readFile(path.join(repository, "package.json"), "utf8"),
    ) as { name?: unknown };
    if (typeof packageJson.name === "string" && packageJson.name.trim()) {
      return packageJson.name.trim();
    }
  } catch {
    // Directory basename remains the stable fallback.
  }
  return path.basename(repository);
}

async function getBranch(repository: string): Promise<string> {
  const branch = await tryGit(repository, [
    "symbolic-ref",
    "--quiet",
    "--short",
    "HEAD",
  ]);
  if (branch) {
    return branch;
  }

  const commit = await tryGit(repository, ["rev-parse", "--short", "HEAD"]);
  return commit ? `detached @ ${commit}` : "No commits";
}

function resolveDirtyPath(repository: string, dirtyPath: string): string | null {
  const resolvedRepository = path.resolve(repository);
  const resolvedPath = path.resolve(repository, dirtyPath);
  const repositoryPrefix = `${resolvedRepository.toLowerCase()}${path.sep}`;

  return resolvedPath.toLowerCase().startsWith(repositoryPrefix)
    ? resolvedPath
    : null;
}

async function getPathModifiedTime(filePath: string): Promise<number | null> {
  try {
    return (await lstat(filePath)).mtimeMs;
  } catch (error) {
    if (!isMissingFileError(error)) {
      return null;
    }

    try {
      return (await lstat(path.dirname(filePath))).mtimeMs;
    } catch {
      return null;
    }
  }
}

async function getLastChangedAt(
  repository: string,
  dirtyPaths: string[],
): Promise<string> {
  const resolvedPaths = [
    ...new Set(
      dirtyPaths
        .map((dirtyPath) => resolveDirtyPath(repository, dirtyPath))
        .filter((dirtyPath): dirtyPath is string => Boolean(dirtyPath)),
    ),
  ];
  const modifiedTimes = await mapWithConcurrency(
    resolvedPaths,
    FILE_STAT_CONCURRENCY,
    getPathModifiedTime,
  );

  const existingDirtyTimes = modifiedTimes.filter(
    (value): value is number => value !== null,
  );
  if (existingDirtyTimes.length > 0) {
    return new Date(Math.max(...existingDirtyTimes)).toISOString();
  }

  const fallbackPaths = [repository];
  const indexPath = await tryGit(repository, ["rev-parse", "--git-path", "index"]);
  if (indexPath) {
    fallbackPaths.push(path.resolve(repository, indexPath));
  }
  const fallbackTimes = await Promise.all(fallbackPaths.map(getPathModifiedTime));
  const latest = Math.max(
    ...fallbackTimes.filter((value): value is number => value !== null),
    0,
  );

  return new Date(latest || Date.now()).toISOString();
}

async function inspectRepository(repository: string): Promise<{
  project: UncommittedProject | null;
  warning: GitScanWarning | null;
}> {
  let statusOutput: string;
  try {
    statusOutput = await runGit(repository, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    ]);
  } catch (error) {
    return {
      project: null,
      warning: { directory: repository, message: formatGitError(error) },
    };
  }

  const status = parsePorcelainStatus(statusOutput);
  if (status.counts.total === 0) {
    return { project: null, warning: null };
  }

  const [name, branch, lastChangedAt] = await Promise.all([
    getProjectName(repository),
    getBranch(repository),
    getLastChangedAt(repository, status.paths),
  ]);

  return {
    project: {
      id: getRepositoryId(repository),
      name,
      directory: repository,
      branch,
      lastChangedAt,
      changes: status.counts,
    },
    warning: null,
  };
}

export async function scanUncommittedProjects(
  roots: readonly string[] = UNCOMMITTED_ROOTS,
): Promise<UncommittedScanResult> {
  if (process.platform !== "win32") {
    throw new Error("The Uncommitted view currently supports Windows only.");
  }

  const discovery = await discoverGitRepositories(roots);
  const inspected = await mapWithConcurrency(
    discovery.repositories,
    REPOSITORY_SCAN_CONCURRENCY,
    inspectRepository,
  );
  const projects = inspected
    .flatMap((result) => (result.project ? [result.project] : []))
    .sort(
      (left, right) =>
        Date.parse(right.lastChangedAt) - Date.parse(left.lastChangedAt) ||
        left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
    );
  const warnings = [
    ...discovery.warnings,
    ...inspected.flatMap((result) => (result.warning ? [result.warning] : [])),
  ];

  return { projects, roots: [...roots], warnings };
}
