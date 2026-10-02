import "server-only";

import { discoverGitRepositories, UNCOMMITTED_ROOTS } from "@/lib/git/uncommitted-scanner";
import { mapWithConcurrency, runGit } from "@/lib/git/run-git";
import type {
  CheckinDay,
  CheckinsResponse,
  CheckinTotals,
  GitScanWarning,
} from "@/lib/git/types";

export const CHECKIN_DAYS = 30;
export const CHECKIN_AUTHORS = ["a.d.schaerer@gmail.com", "andruuid"] as const;

const REPOSITORY_SCAN_CONCURRENCY = 4;
const LOG_TIMEOUT_MS = 30_000;
const LOG_MAX_BUFFER = 64 * 1024 * 1024;
const LOCKFILE_NAMES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
]);

export interface ParsedCheckin {
  hash: string;
  date: string;
  added: number;
  removed: number;
}

export type CheckinsScanResult = Omit<CheckinsResponse, "scannedAt">;

interface GitCommandFailure extends Error {
  code?: string | number;
  killed?: boolean;
  stderr?: string;
}

function isLockfile(changedPath: string): boolean {
  const name = changedPath.split(/[\\/]/).pop() ?? changedPath;
  return LOCKFILE_NAMES.has(name);
}

export function parseCheckinLog(output: string): ParsedCheckin[] {
  const checkins: ParsedCheckin[] = [];

  for (const record of output.split("\0")) {
    const [header, ...lines] = record.split(/\r?\n/);
    const [hash, date] = (header ?? "").split("\x1f");
    if (!hash || !date) {
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

    checkins.push({ hash, date, added, removed });
  }

  return checkins;
}

function toLocalDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function getWindowStart(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - (CHECKIN_DAYS - 1));
}

export function buildCheckinDays(
  checkins: readonly ParsedCheckin[],
  now: Date,
): { days: CheckinDay[]; totals: CheckinTotals } {
  const start = getWindowStart(now);
  const days = new Map<string, CheckinDay>();
  for (let offset = 0; offset < CHECKIN_DAYS; offset += 1) {
    const date = toLocalDateKey(
      new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset),
    );
    days.set(date, { date, commits: 0, added: 0, removed: 0 });
  }

  const seen = new Set<string>();
  for (const checkin of checkins) {
    if (seen.has(checkin.hash)) {
      continue;
    }
    seen.add(checkin.hash);

    const committedAt = new Date(checkin.date);
    if (Number.isNaN(committedAt.getTime())) {
      continue;
    }
    const day = days.get(toLocalDateKey(committedAt));
    if (!day) {
      continue;
    }
    day.commits += 1;
    day.added += checkin.added;
    day.removed += checkin.removed;
  }

  const orderedDays = [...days.values()];
  const totals = orderedDays.reduce<CheckinTotals>(
    (sum, day) => ({
      commits: sum.commits + day.commits,
      added: sum.added + day.added,
      removed: sum.removed + day.removed,
    }),
    { commits: 0, added: 0, removed: 0 },
  );

  return { days: orderedDays, totals };
}

function formatGitError(error: unknown): string {
  const failure = error as GitCommandFailure;
  if (failure.killed || failure.code === "ETIMEDOUT") {
    return "Git log timed out after thirty seconds.";
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
        "--format=%x00%H%x1f%aI",
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

export async function scanCheckins(
  roots: readonly string[] = UNCOMMITTED_ROOTS,
  now: Date = new Date(),
): Promise<CheckinsScanResult> {
  if (process.platform !== "win32") {
    throw new Error("The Github Checkinis view currently supports Windows only.");
  }

  const since = getWindowStart(now).toISOString().replace(/\.\d{3}Z$/, "Z");
  const discovery = await discoverGitRepositories(roots);
  const results = await mapWithConcurrency(
    discovery.repositories,
    REPOSITORY_SCAN_CONCURRENCY,
    (repository) => readRepositoryCheckins(repository, since),
  );

  const { days, totals } = buildCheckinDays(
    results.flatMap((result) => result.checkins),
    now,
  );

  return {
    days,
    totals,
    repositoriesScanned: discovery.repositories.length,
    roots: [...roots],
    warnings: [
      ...discovery.warnings,
      ...results.flatMap((result) => (result.warning ? [result.warning] : [])),
    ],
  };
}
