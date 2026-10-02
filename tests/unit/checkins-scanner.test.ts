import { describe, expect, test } from "vitest";

import { buildCheckinDays, parseCheckinLog } from "@/lib/git/checkins-scanner";

function log(
  commits: { hash: string; date: string; stats?: string[] }[],
): string {
  return commits
    .map(
      (commit) =>
        `\0${commit.hash}\x1f${commit.date}\n\n${(commit.stats ?? []).join("\n")}\n`,
    )
    .join("");
}

describe("parseCheckinLog", () => {
  test("sums added and removed lines per commit", () => {
    const output = log([
      {
        hash: "aaa",
        date: "2026-10-02T09:00:00+02:00",
        stats: ["10\t2\tsrc/a.ts", "5\t0\tsrc/b.ts"],
      },
      { hash: "bbb", date: "2026-10-01T09:00:00+02:00", stats: ["1\t1\tREADME.md"] },
    ]);

    expect(parseCheckinLog(output)).toEqual([
      { hash: "aaa", date: "2026-10-02T09:00:00+02:00", added: 15, removed: 2 },
      { hash: "bbb", date: "2026-10-01T09:00:00+02:00", added: 1, removed: 1 },
    ]);
  });

  test("ignores binary files and lockfiles but keeps the commit", () => {
    const output = log([
      {
        hash: "aaa",
        date: "2026-10-02T09:00:00+02:00",
        stats: ["-\t-\timage.png", "4000\t3000\tpackage-lock.json", "3\t1\tapp/yarn.lock"],
      },
    ]);

    expect(parseCheckinLog(output)).toEqual([
      { hash: "aaa", date: "2026-10-02T09:00:00+02:00", added: 0, removed: 0 },
    ]);
  });

  test("returns nothing for empty output", () => {
    expect(parseCheckinLog("")).toEqual([]);
  });
});

describe("buildCheckinDays", () => {
  const now = new Date(2026, 9, 2, 15, 0, 0);

  function at(month: number, day: number, hour = 12): string {
    return new Date(2026, month, day, hour).toISOString();
  }

  test("always returns 30 zero-filled days ending today", () => {
    const { days, totals } = buildCheckinDays([], now);

    expect(days).toHaveLength(30);
    expect(days[0].date).toBe("2026-09-03");
    expect(days[29].date).toBe("2026-10-02");
    expect(totals).toEqual({ commits: 0, added: 0, removed: 0 });
  });

  test("buckets commits by local day and totals them", () => {
    const { days, totals } = buildCheckinDays(
      [
        { hash: "a", date: at(9, 2, 8), added: 10, removed: 2 },
        { hash: "b", date: at(9, 2, 23), added: 5, removed: 5 },
        { hash: "c", date: at(8, 3, 0), added: 1, removed: 0 },
      ],
      now,
    );

    expect(days[29]).toEqual({ date: "2026-10-02", commits: 2, added: 15, removed: 7 });
    expect(days[0]).toEqual({ date: "2026-09-03", commits: 1, added: 1, removed: 0 });
    expect(totals).toEqual({ commits: 3, added: 16, removed: 7 });
  });

  test("counts a commit hash found in several repositories once", () => {
    const { totals } = buildCheckinDays(
      [
        { hash: "same", date: at(9, 1), added: 3, removed: 1 },
        { hash: "same", date: at(9, 1), added: 3, removed: 1 },
      ],
      now,
    );

    expect(totals).toEqual({ commits: 1, added: 3, removed: 1 });
  });

  test("drops commits outside the 30 day window", () => {
    const { totals } = buildCheckinDays(
      [
        { hash: "old", date: at(8, 2), added: 99, removed: 99 },
        { hash: "future", date: at(9, 3), added: 99, removed: 99 },
      ],
      now,
    );

    expect(totals.commits).toBe(0);
  });
});
