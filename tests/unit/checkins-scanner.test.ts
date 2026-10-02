import { describe, expect, test } from "vitest";

import { parseCheckinLog } from "@/lib/git/checkins-scanner";

function log(
  commits: { hash: string; at: number; subject?: string; stats?: string[] }[],
): string {
  return commits
    .map(
      (commit) =>
        `\0${commit.hash}\x1f${commit.at}\x1f${commit.subject ?? "msg"}\n\n${(commit.stats ?? []).join("\n")}\n`,
    )
    .join("");
}

describe("parseCheckinLog", () => {
  test("sums added and removed lines per commit and keeps the subject", () => {
    const output = log([
      {
        hash: "aaa",
        at: 1_790_000_000,
        subject: "Add the thing",
        stats: ["10\t2\tsrc/a.ts", "5\t0\tsrc/b.ts"],
      },
      { hash: "bbb", at: 1_789_900_000, stats: ["1\t1\tREADME.md"] },
    ]);

    expect(parseCheckinLog(output)).toEqual([
      { hash: "aaa", at: 1_790_000_000, added: 15, removed: 2, subject: "Add the thing" },
      { hash: "bbb", at: 1_789_900_000, added: 1, removed: 1, subject: "msg" },
    ]);
  });

  test("ignores binary files and lockfiles but keeps the commit", () => {
    const output = log([
      {
        hash: "aaa",
        at: 1_790_000_000,
        stats: ["-\t-\timage.png", "4000\t3000\tpackage-lock.json", "3\t1\tapp/yarn.lock"],
      },
    ]);

    expect(parseCheckinLog(output)).toEqual([
      { hash: "aaa", at: 1_790_000_000, added: 0, removed: 0, subject: "msg" },
    ]);
  });

  test("keeps subjects that contain the field separator", () => {
    const output = log([{ hash: "aaa", at: 1_790_000_000, subject: "a\x1fb" }]);

    expect(parseCheckinLog(output)[0].subject).toBe("a\x1fb");
  });

  test("skips records without a valid timestamp and empty output", () => {
    expect(parseCheckinLog("")).toEqual([]);
    expect(parseCheckinLog("\0aaa\x1fnot-a-number\x1fmsg\n")).toEqual([]);
  });
});
