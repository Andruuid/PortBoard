import { describe, expect, test } from "vitest";

import {
  buildSeries,
  bucketSeries,
  countCommitsSince,
  filterCommits,
  groupByDay,
  levelFor,
  levelThresholds,
  monthsBreakdown,
  movingAverage,
  niceScale,
  pickGranularity,
  repoStats,
  summarize,
  toDateKey,
  weekdayHourMatrix,
} from "@/lib/git/checkin-stats";
import type { CheckinCommit } from "@/lib/git/types";

function commit(
  hash: string,
  local: [number, number, number, number?, number?],
  extra: Partial<CheckinCommit> = {},
): CheckinCommit {
  const [year, month, day, hour = 12, minute = 0] = local;
  return {
    hash,
    repo: 0,
    at: new Date(year, month - 1, day, hour, minute).getTime() / 1000,
    added: 10,
    removed: 2,
    subject: `commit ${hash}`,
    ...extra,
  };
}

const NOW = new Date(2026, 9, 2, 15, 0, 0); // Fri 2 Oct 2026

describe("filterCommits", () => {
  const commits = [
    commit("aaa111", [2026, 10, 1], { repo: 0, subject: "Fix login bug" }),
    commit("bbb222", [2026, 10, 1], { repo: 1, subject: "Add calendar" }),
  ];

  test("returns everything without filters", () => {
    expect(filterCommits(commits, { repos: null, query: "  " })).toHaveLength(2);
  });

  test("filters by repository and by message or hash prefix", () => {
    expect(filterCommits(commits, { repos: new Set([1]), query: "" }).map((c) => c.hash)).toEqual([
      "bbb222",
    ]);
    expect(filterCommits(commits, { repos: null, query: "LOGIN" }).map((c) => c.hash)).toEqual([
      "aaa111",
    ]);
    expect(filterCommits(commits, { repos: null, query: "bbb2" }).map((c) => c.hash)).toEqual([
      "bbb222",
    ]);
  });
});

describe("groupByDay and buildSeries", () => {
  test("buckets by local day and zero-fills the requested range", () => {
    const byDay = groupByDay([
      commit("a", [2026, 10, 2, 8], { added: 10, removed: 2, repo: 0 }),
      commit("b", [2026, 10, 2, 23], { added: 5, removed: 5, repo: 1 }),
      commit("c", [2026, 10, 1, 0, 5], { added: 1, removed: 0 }),
    ]);
    const series = buildSeries(byDay, new Date(2026, 9, 1), new Date(2026, 9, 3));

    expect(series.map((day) => day.key)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(series.map((day) => day.commits)).toEqual([1, 2, 0]);
    expect(series[1]).toMatchObject({ added: 15, removed: 7 });
    expect([...series[1].repos.entries()]).toEqual([
      [0, 1],
      [1, 1],
    ]);
  });
});

describe("summarize", () => {
  const byDay = groupByDay([
    commit("a", [2026, 9, 28]),
    commit("b", [2026, 9, 29]),
    commit("c", [2026, 9, 29]),
    commit("d", [2026, 10, 1]),
  ]);

  test("computes totals, streaks and the busiest day", () => {
    const series = buildSeries(byDay, new Date(2026, 8, 28), new Date(2026, 9, 2));
    const summary = summarize(series, true);

    expect(summary).toMatchObject({
      commits: 4,
      activeDays: 3,
      totalDays: 5,
      longestStreak: 2,
      currentStreak: 1,
    });
    expect(summary.busiest?.key).toBe("2026-09-29");
    expect(summary.averagePerActiveDay).toBeCloseTo(4 / 3);
  });

  test("an empty today does not break the current streak, an empty yesterday does", () => {
    const upToToday = buildSeries(byDay, new Date(2026, 8, 28), new Date(2026, 9, 2));
    expect(summarize(upToToday, true).currentStreak).toBe(1);
    expect(summarize(upToToday, false).currentStreak).toBe(0);
  });
});

describe("heat levels", () => {
  test("maps values onto quartile based levels", () => {
    const thresholds = levelThresholds([0, 1, 2, 3, 4, 5, 6, 7, 8]);

    expect(levelFor(0, thresholds)).toBe(0);
    expect(levelFor(1, thresholds)).toBe(1);
    expect(levelFor(8, thresholds)).toBe(4);
    expect(levelFor(5, thresholds)).toBeGreaterThanOrEqual(2);
  });

  test("has sane defaults without data", () => {
    expect(levelThresholds([0, 0])).toEqual([1, 2, 3]);
  });
});

describe("bucketSeries", () => {
  test("picks a granularity from the range length", () => {
    expect(pickGranularity(30)).toBe("day");
    expect(pickGranularity(90)).toBe("week");
    expect(pickGranularity(365)).toBe("month");
  });

  test("groups days into Monday-based weeks and calendar months", () => {
    const byDay = groupByDay([commit("a", [2026, 9, 30]), commit("b", [2026, 10, 2])]);
    const series = buildSeries(byDay, new Date(2026, 8, 28), new Date(2026, 9, 4));

    const weeks = bucketSeries(series, "week");
    expect(weeks).toHaveLength(1);
    expect(weeks[0]).toMatchObject({ start: "2026-09-28", commits: 2 });

    const months = bucketSeries(series, "month");
    expect(months.map((bucket) => [bucket.start, bucket.commits])).toEqual([
      ["2026-09-01", 1],
      ["2026-10-01", 1],
    ]);
  });
});

describe("movingAverage", () => {
  test("averages over the values available so far at the start", () => {
    expect(movingAverage([2, 4, 6, 8], 2)).toEqual([2, 3, 5, 7]);
  });
});

describe("weekdayHourMatrix", () => {
  test("places commits by Monday-first weekday and local hour", () => {
    const matrix = weekdayHourMatrix(
      [commit("a", [2026, 10, 2, 14]), commit("b", [2026, 10, 2, 14]), commit("c", [2026, 10, 4, 3])],
      "commits",
    );

    expect(matrix).toHaveLength(7);
    expect(matrix[4][14]).toBe(2); // Friday 14:00
    expect(matrix[6][3]).toBe(1); // Sunday 03:00
  });

  test("sums lines for line based metrics", () => {
    const matrix = weekdayHourMatrix([commit("a", [2026, 10, 2, 14], { added: 7, removed: 3 })], "churn");

    expect(matrix[4][14]).toBe(10);
  });
});

describe("repoStats", () => {
  test("aggregates per repository inside the range and ignores outside commits", () => {
    const stats = repoStats(
      [
        commit("a", [2026, 10, 1], { repo: 0 }),
        commit("b", [2026, 10, 2], { repo: 0 }),
        commit("c", [2026, 10, 2], { repo: 1 }),
        commit("old", [2026, 8, 1], { repo: 1 }),
      ],
      new Date(2026, 9, 1),
      new Date(2026, 9, 2),
    );

    const first = stats.find((stat) => stat.repo === 0);
    expect(first).toMatchObject({ commits: 2, activeDays: 2, daily: [1, 1] });
    expect(stats.find((stat) => stat.repo === 1)).toMatchObject({ commits: 1, daily: [0, 1] });
  });
});

describe("monthsBreakdown", () => {
  test("returns twelve months ending with the current one and flags partial months", () => {
    const byDay = groupByDay([commit("a", [2026, 10, 1]), commit("b", [2026, 9, 15])]);
    const months = monthsBreakdown(byDay, new Date(2025, 9, 4), NOW);

    expect(months).toHaveLength(12);
    expect(months[0].key).toBe("2025-11-01");
    expect(months[11]).toMatchObject({ key: "2026-10-01", commits: 1, partial: true });
    expect(months[10]).toMatchObject({ key: "2026-09-01", commits: 1, partial: false });
  });
});

describe("helpers", () => {
  test("countCommitsSince counts a trailing window of whole days", () => {
    const commits = [commit("a", [2026, 10, 2]), commit("b", [2026, 9, 3]), commit("c", [2026, 9, 2])];

    expect(countCommitsSince(commits, 30, NOW)).toBe(2);
  });

  test("niceScale rounds up to a tidy step", () => {
    expect(niceScale(0)).toEqual({ max: 4, step: 1 });
    expect(niceScale(97)).toEqual({ max: 100, step: 25 });
    expect(niceScale(12)).toEqual({ max: 15, step: 5 });
  });

  test("toDateKey uses the local calendar day", () => {
    expect(toDateKey(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});
