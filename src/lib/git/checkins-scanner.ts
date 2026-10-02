import "server-only";

import path from "node:path";

import { mapWithConcurrency, runGit } from "@/lib/git/run-git";
import type {
  CheckinCommit,
  CheckinRepository,
  CheckinsResponse,
  GitScanWarning,
} from "@/lib/git/types";
import {
  discoverGitRepositories,
  UNCOMMITTED_ROOTS,
} from "@/lib/git/uncommitted-scanner";

export const CHECKIN_WINDOW_DAYS = 365;
export const CHECKIN_AUTHORS = ["a.d.schaerer@gmail.com", "andruuid"] as const;

const REPOSITORY_SCAN_CONCURRENCY = 4;
const LOG_TIMEOUT_MS = 120_000;
const LOG_MAX_BUFFER = 64 * 1024 * 1024;
const MAX_SUBJECT_LENGTH = 200;
// Commit stats never change, so only recent history is re-read between scans.
const FULL_RESCAN_MS = 6 * 60 * 60 * 1000;
const INCREMENTAL_OVERLAP_MS = 7 * 24 * 60 * 60 * 1000;
const LOCKFILE_NAMES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
]);

export interface ParsedCheckin {
  hash: string;
  at: number;
  added: number;
  removed: number;
  subject: string;
}

interface CachedCheckin extends ParsedCheckin {
  directory: string;
}

interface CheckinCache {
  commits: Map<string, CachedCheckin>;
  lastScanAt: number;
  lastFullScanAt: number;
}

export type CheckinsScanResult = Omit<CheckinsResponse, "scannedAt">;

export interface ScanCheckinsOptions {
  /** Ignore cached history and read the whole window again. */
  fullRescan?: boolean;
}

interface GitCommandFailure extends Error {
  code?: string | number;
  killed?: boolean;
  stderr?: string;
}

const cacheStore = globalThis as typeof globalThis & {
  __portboardCheckinCaches?: Map<string, CheckinCache>;
};

function getCaches(): Map<string, CheckinCache> {
  cacheStore.__portboardCheckinCaches ??= new Map();
  return cacheStore.__portboardCheckinCaches;
}

function isLockfile(changedPath: string): boolean {
  const name = changedPath.split(/[\\/]/).pop() ?? changedPath;
  return LOCKFILE_NAMES.has(name);
}

export function parseCheckinLog(output: string): ParsedCheckin[] {
  const checkins: ParsedCheckin[] = [];

  for (const record of output.split("\0")) {
    const [header, ...lines] = record.split(/\r?\n/);
    const [hash, atText, ...subjectParts] = (header ?? "").split("\x1f");
    const at = Number(atText);
    if (!hash || !Number.isFinite(at)) {
      continue;
    }

    let added = 0;
    let removed = 0;
    for (const line of lines) {
      const [addedText, removedText, ...pathParts] = line.split("\t");
      if (pathParts.length === 0 || isLockfile(pathParts.join("\t"))) {
        continue;
      }
      // Binary files report "-" and contribute no lines.
      added += Number.parseInt(addedText, 10) || 0;
      removed += Number.parseInt(removedText, 10) || 0;
    }

    checkins.push({
      hash,
      at,
      added,
      removed,
      subject: subjectParts.join("\x1f").trim().slice(0, MAX_SUBJECT_LENGTH),
    });
  }

  return checkins;
}

export function getWindowStart(now: Date): Date {
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - (CHECKIN_WINDOW_DAYS - 1),
  );
}

function formatGitError(error: unknown): string {
  const failure = error as GitCommandFailure;
  if (failure.killed || failure.code === "ETIMEDOUT") {
    return "Git log timed out after two minutes.";
  }

  const details = failure.stderr?.trim().split(/\r?\n/, 1)[0];
  return details || "Git log could not be read.";
}

async function readRepositoryCheckins(
  repository: string,
  since: string,
): Promise<{ checkins: ParsedCheckin[]; warning: GitScanWarning | null }> {
  try {
    const output = await runGit(
      repository,
      [
        "log",
        "--all",
        "--no-merges",
        `--since=${since}`,
        ...CHECKIN_AUTHORS.map((author) => `--author=${author}`),
        "--numstat",
        "--format=%x00%H%x1f%at%x1f%s",
      ],
      { timeoutMs: LOG_TIMEOUT_MS, maxBuffer: LOG_MAX_BUFFER },
    );
    return { checkins: parseCheckinLog(output), warning: null };
  } catch (error) {
    const failure = error as GitCommandFailure;
    // A repository without any commit yet has nothing to count.
    if (failure.stderr?.includes("does not have any commits")) {
      return { checkins: [], warning: null };
    }
    return {
      checkins: [],
      warning: { directory: repository, message: formatGitError(error) },
    };
  }
}

function buildRepositories(directories: readonly string[]): CheckinRepository[] {
  const baseNameCounts = new Map<string, number>();
  for (const directory of directories) {
    const name = path.basename(directory).toLowerCase();
    baseNameCounts.set(name, (baseNameCounts.get(name) ?? 0) + 1);
  }

  return directories.map((directory) => {
    const baseName = path.basename(directory);
    const isAmbiguous = (baseNameCounts.get(baseName.toLowerCase()) ?? 0) > 1;
    const name = isAmbiguous
      ? `${path.basename(path.dirname(directory))}/${baseName}`
      : baseName;
    return { name, directory };
  });
}

export async function scanCheckins(
  roots: readonly string[] = UNCOMMITTED_ROOTS,
  now: Date = new Date(),
  options: ScanCheckinsOptions = {},
): Promise<CheckinsScanResult> {
  if (process.platform !== "win32") {
    throw new Error("The Github Checkinis view currently supports Windows only.");
  }

  const windowStart = getWindowStart(now);
  const caches = getCaches();
  const cacheKey = roots.join("|").toLowerCase();
  const previous = caches.get(cacheKey);
  const isFullScan =
    options.fullRescan === true ||
    !previous ||
    now.getTime() - previous.lastFullScanAt > FULL_RESCAN_MS;

  const sinceDate =
    isFullScan || !previous
      ? windowStart
      : new Date(
          Math.max(
            windowStart.getTime(),
            previous.lastScanAt - INCREMENTAL_OVERLAP_MS,
          ),
        );
  const since = sinceDate.toISOString().replace(/\.\d{3}Z$/, "Z");

  const discovery = await discoverGitRepositories(roots);
  const results = await mapWithConcurrency(
    discovery.repositories,
    REPOSITORY_SCAN_CONCURRENCY,
    async (repository) => ({
      repository,
      ...(await readRepositoryCheckins(repository, since)),
    }),
  );

  const commits = new Map<string, CachedCheckin>(
    isFullScan || !previous ? [] : previous.commits,
  );
  for (const result of results) {
    for (const checkin of result.checkins) {
      // The same commit can live in several clones or worktrees; keep the first.
      if (!commits.has(checkin.hash)) {
        commits.set(checkin.hash, { ...checkin, directory: result.repository });
      }
    }
  }
  for (const [hash, commit] of commits) {
    if (commit.at * 1000 < windowStart.getTime()) {
      commits.delete(hash);
    }
  }

  caches.set(cacheKey, {
    commits,
    lastScanAt: now.getTime(),
    lastFullScanAt:
      isFullScan || !previous ? now.getTime() : previous.lastFullScanAt,
  });

  const repositories = buildRepositories(discovery.repositories);
  const repositoryIndex = new Map(
    discovery.repositories.map((directory, index) => [directory, index]),
  );
  const orderedCommits: CheckinCommit[] = [];
  for (const commit of commits.values()) {
    const repo = repositoryIndex.get(commit.directory);
    if (repo === undefined) {
      continue;
    }
    orderedCommits.push({
      hash: commit.hash,
      repo,
      at: commit.at,
      added: commit.added,
      removed: commit.removed,
      subject: commit.subject,
    });
  }
  // Hash as tie-breaker keeps commits with identical timestamps in a stable order.
  orderedCommits.sort(
    (left, right) => right.at - left.at || left.hash.localeCompare(right.hash),
  );

  return {
    commits: orderedCommits,
    repositories,
    windowDays: CHECKIN_WINDOW_DAYS,
    repositoriesScanned: discovery.repositories.length,
    roots: [...roots],
    warnings: [
      ...discovery.warnings,
      ...results.flatMap((result) => (result.warning ? [result.warning] : [])),
    ],
  };
}

export function clearCheckinCaches(): void {
  getCaches().clear();
}
