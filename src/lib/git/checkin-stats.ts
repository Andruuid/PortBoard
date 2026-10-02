import type { CheckinCommit } from "@/lib/git/types";

export type CheckinMetric = "commits" | "added" | "removed" | "churn";
export type Granularity = "day" | "week" | "month";
export type HeatLevel = 0 | 1 | 2 | 3 | 4;

const DAY_MS = 86_400_000;

export interface DayStat {
  key: string;
  commits: number;
  added: number;
  removed: number;
  /** Commit count per repository index. */
  repos: Map<number, number>;
}

export interface RangeSummary {
  commits: number;
  added: number;
  removed: number;
  activeDays: number;
  totalDays: number;
  longestStreak: number;
  currentStreak: number;
  busiest: DayStat | null;
  averagePerActiveDay: number;
}

export interface Bucket {
  key: string;
  start: string;
  label: string;
  commits: number;
  added: number;
  removed: number;
}

export interface RepoStat {
  repo: number;
  commits: number;
  added: number;
  removed: number;
  activeDays: number;
  lastAt: number;
  /** Commits per day, aligned with the requested range. */
  daily: number[];
}

export interface MonthStat {
  key: string;
  label: string;
  commits: number;
  added: number;
  removed: number;
  activeDays: number;
  partial: boolean;
}

export interface CheckinFilters {
  repos: ReadonlySet<number> | null;
  query: string;
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function diffDays(later: Date, earlier: Date): number {
  return Math.round(
    (startOfDay(later).getTime() - startOfDay(earlier).getTime()) / DAY_MS,
  );
}

export function toDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function fromDateKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function commitDate(commit: Pick<CheckinCommit, "at">): Date {
  return new Date(commit.at * 1000);
}

export function commitDateKey(commit: Pick<CheckinCommit, "at">): string {
  return toDateKey(commitDate(commit));
}

/** Monday-based weekday index: Monday 0 … Sunday 6. */
export function weekdayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

export function startOfWeek(date: Date): Date {
  return addDays(startOfDay(date), -weekdayIndex(date));
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

export function filterCommits(
  commits: readonly CheckinCommit[],
  filters: CheckinFilters,
): CheckinCommit[] {
  const query = filters.query.trim().toLowerCase();
  if (!filters.repos && !query) {
    return [...commits];
  }

  return commits.filter(
    (commit) =>
      (!filters.repos || filters.repos.has(commit.repo)) &&
      (!query ||
        commit.subject.toLowerCase().includes(query) ||
        commit.hash.startsWith(query)),
  );
}

function createDayStat(key: string): DayStat {
  return { key, commits: 0, added: 0, removed: 0, repos: new Map() };
}

export function groupByDay(commits: readonly CheckinCommit[]): Map<string, DayStat> {
  const days = new Map<string, DayStat>();

  for (const commit of commits) {
    const key = commitDateKey(commit);
    let day = days.get(key);
    if (!day) {
      day = createDayStat(key);
      days.set(key, day);
    }
    day.commits += 1;
    day.added += commit.added;
    day.removed += commit.removed;
    day.repos.set(commit.repo, (day.repos.get(commit.repo) ?? 0) + 1);
  }

  return days;
}

/** Zero-filled daily series from `start` to `end`, both inclusive. */
export function buildSeries(
  byDay: ReadonlyMap<string, DayStat>,
  start: Date,
  end: Date,
): DayStat[] {
  const length = diffDays(end, start) + 1;
  const series: DayStat[] = [];

  for (let offset = 0; offset < length; offset += 1) {
    const key = toDateKey(addDays(start, offset));
    series.push(byDay.get(key) ?? createDayStat(key));
  }

  return series;
}

export function metricValue(
  stat: Pick<DayStat, "commits" | "added" | "removed">,
  metric: CheckinMetric,
): number {
  switch (metric) {
    case "commits":
      return stat.commits;
    case "added":
      return stat.added;
    case "removed":
      return stat.removed;
    case "churn":
      return stat.added + stat.removed;
  }
}

export function summarize(series: readonly DayStat[], endsToday: boolean): RangeSummary {
  let commits = 0;
  let added = 0;
  let removed = 0;
  let activeDays = 0;
  let longestStreak = 0;
  let runningStreak = 0;
  let busiest: DayStat | null = null;

  for (const day of series) {
    commits += day.commits;
    added += day.added;
    removed += day.removed;

    if (day.commits > 0) {
      activeDays += 1;
      runningStreak += 1;
      longestStreak = Math.max(longestStreak, runningStreak);
      if (!busiest || day.commits > busiest.commits) {
        busiest = day;
      }
    } else {
      runningStreak = 0;
    }
  }

  // Today may still be empty without breaking a streak that reaches yesterday.
  let index = series.length - 1;
  if (endsToday && index >= 0 && series[index].commits === 0) {
    index -= 1;
  }
  let currentStreak = 0;
  while (index >= 0 && series[index].commits > 0) {
    currentStreak += 1;
    index -= 1;
  }

  return {
    commits,
    added,
    removed,
    activeDays,
    totalDays: series.length,
    longestStreak,
    currentStreak,
    busiest,
    averagePerActiveDay: activeDays > 0 ? commits / activeDays : 0,
  };
}

function quantile(sorted: readonly number[], fraction: number): number {
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
  return sorted[index];
}

/** Upper bounds of heat levels 1-3; anything above the last bound is level 4. */
export function levelThresholds(values: readonly number[]): [number, number, number] {
  const positive = values.filter((value) => value > 0).sort((a, b) => a - b);
  if (positive.length === 0) {
    return [1, 2, 3];
  }

  return [quantile(positive, 0.25), quantile(positive, 0.5), quantile(positive, 0.75)];
}

export function levelFor(
  value: number,
  thresholds: readonly [number, number, number],
): HeatLevel {
  if (value <= 0) return 0;
  if (value <= thresholds[0]) return 1;
  if (value <= thresholds[1]) return 2;
  if (value <= thresholds[2]) return 3;
  return 4;
}

export function pickGranularity(dayCount: number): Granularity {
  if (dayCount <= 45) return "day";
  if (dayCount <= 200) return "week";
  return "month";
}

function formatBucketLabel(start: Date, granularity: Granularity): string {
  if (granularity === "month") {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      year: "numeric",
    }).format(start);
  }

  const label = new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
  }).format(start);
  return granularity === "week" ? `Week of ${label}` : label;
}

export function bucketSeries(
  series: readonly DayStat[],
  granularity: Granularity,
): Bucket[] {
  const buckets = new Map<string, Bucket>();

  for (const day of series) {
    const date = fromDateKey(day.key);
    const start =
      granularity === "day"
        ? date
        : granularity === "week"
          ? startOfWeek(date)
          : startOfMonth(date);
    const key = toDateKey(start);

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        key,
        start: key,
        label: formatBucketLabel(start, granularity),
        commits: 0,
        added: 0,
        removed: 0,
      };
      buckets.set(key, bucket);
    }
    bucket.commits += day.commits;
    bucket.added += day.added;
    bucket.removed += day.removed;
  }

  return [...buckets.values()];
}

/** Trailing average; early positions average over the values available so far. */
export function movingAverage(values: readonly number[], window: number): number[] {
  return values.map((_, index) => {
    const from = Math.max(0, index - window + 1);
    const slice = values.slice(from, index + 1);
    return slice.reduce((sum, value) => sum + value, 0) / slice.length;
  });
}

/** 7 × 24 matrix, rows Monday-first, columns local hour of day. */
export function weekdayHourMatrix(
  commits: readonly CheckinCommit[],
  metric: CheckinMetric,
): number[][] {
  const matrix = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));

  for (const commit of commits) {
    const date = commitDate(commit);
    matrix[weekdayIndex(date)][date.getHours()] += metricValue(
      { commits: 1, added: commit.added, removed: commit.removed },
      metric,
    );
  }

  return matrix;
}

export function repoStats(
  commits: readonly CheckinCommit[],
  start: Date,
  end: Date,
): RepoStat[] {
  const length = diffDays(end, start) + 1;
  const stats = new Map<number, RepoStat & { days: Set<string> }>();

  for (const commit of commits) {
    const offset = diffDays(commitDate(commit), start);
    if (offset < 0 || offset >= length) {
      continue;
    }

    let stat = stats.get(commit.repo);
    if (!stat) {
      stat = {
        repo: commit.repo,
        commits: 0,
        added: 0,
        removed: 0,
        activeDays: 0,
        lastAt: 0,
        daily: new Array<number>(length).fill(0),
        days: new Set(),
      };
      stats.set(commit.repo, stat);
    }
    stat.commits += 1;
    stat.added += commit.added;
    stat.removed += commit.removed;
    stat.lastAt = Math.max(stat.lastAt, commit.at);
    stat.daily[offset] += 1;
    stat.days.add(commitDateKey(commit));
  }

  return [...stats.values()].map(({ days, ...stat }) => ({
    ...stat,
    activeDays: days.size,
  }));
}

/** The `count` calendar months ending with the month of `end`, oldest first. */
export function monthsBreakdown(
  byDay: ReadonlyMap<string, DayStat>,
  windowStart: Date,
  end: Date,
  count = 12,
): MonthStat[] {
  const months: MonthStat[] = [];

  for (let back = count - 1; back >= 0; back -= 1) {
    const first = new Date(end.getFullYear(), end.getMonth() - back, 1);
    const last = endOfMonth(first);
    const stat: MonthStat = {
      key: toDateKey(first),
      label: new Intl.DateTimeFormat(undefined, {
        month: "short",
        year: "2-digit",
      }).format(first),
      commits: 0,
      added: 0,
      removed: 0,
      activeDays: 0,
      partial: first < windowStart || last > end,
    };

    for (let day = new Date(first); day <= last; day = addDays(day, 1)) {
      const entry = byDay.get(toDateKey(day));
      if (entry) {
        stat.commits += entry.commits;
        stat.added += entry.added;
        stat.removed += entry.removed;
        stat.activeDays += 1;
      }
    }
    months.push(stat);
  }

  return months;
}

export function countCommitsSince(
  commits: readonly CheckinCommit[],
  days: number,
  now: Date,
): number {
  const start = addDays(startOfDay(now), -(days - 1)).getTime() / 1000;
  return commits.reduce((count, commit) => count + (commit.at >= start ? 1 : 0), 0);
}

const compactFormat = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});
const fullFormat = new Intl.NumberFormat();

export function formatCompact(value: number): string {
  return compactFormat.format(value);
}

export function formatNumber(value: number): string {
  return fullFormat.format(value);
}

export function formatSigned(value: number): string {
  return `${value > 0 ? "+" : ""}${fullFormat.format(value)}`;
}

/** Round a chart maximum up to a tidy tick step (1, 2, 2.5, 5 × 10ⁿ). */
export function niceScale(max: number, tickCount = 4): { max: number; step: number } {
  if (max <= 0) {
    return { max: tickCount, step: 1 };
  }

  const rawStep = max / tickCount;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step =
    [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((value) => value >= rawStep) ??
    10 * magnitude;
  return { max: Math.ceil(max / step) * step, step };
}
