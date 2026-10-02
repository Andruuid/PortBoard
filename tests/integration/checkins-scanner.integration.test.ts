import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { clearCheckinCaches, scanCheckins } from "@/lib/git/checkins-scanner";

const windowsDescribe = process.platform === "win32" ? describe : describe.skip;

function git(
  repository: string,
  argumentsList: string[],
  env: Record<string, string> = {},
) {
  const result = spawnSync("git.exe", ["-C", repository, ...argumentsList], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${argumentsList.join(" ")} failed`);
  }
}

function commitAs(
  repository: string,
  email: string,
  message: string,
  minutesAgo: number,
) {
  // Distinct timestamps keep the newest-first order deterministic.
  const date = new Date(Date.now() - minutesAgo * 60_000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
  git(repository, ["add", "."]);
  git(repository, ["commit", "-m", message], {
    GIT_AUTHOR_NAME: "Fixture Author",
    GIT_AUTHOR_EMAIL: email,
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_NAME: "Fixture Author",
    GIT_COMMITTER_EMAIL: email,
    GIT_COMMITTER_DATE: date,
  });
}

windowsDescribe("check-in scanner integration", () => {
  let temporaryRoot = "";
  let repository = "";

  beforeAll(async () => {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "portboard-checkins-"));
    const scanRoot = path.join(temporaryRoot, "projects");
    repository = path.join(scanRoot, "tracked-project");
    await mkdir(repository, { recursive: true });
    git(repository, ["init", "-b", "main"]);

    await writeFile(path.join(repository, "mine.txt"), "one\ntwo\nthree\n", "utf8");
    await writeFile(path.join(repository, "package-lock.json"), "{}\n".repeat(50), "utf8");
    commitAs(repository, "a.d.schaerer@gmail.com", "Mine", 30);

    await writeFile(path.join(repository, "mine.txt"), "one\nthree\nfour\nfive\n", "utf8");
    commitAs(repository, "123+andruuid@users.noreply.github.com", "Mine via noreply", 20);

    await writeFile(path.join(repository, "other.txt"), "x\ny\n", "utf8");
    commitAs(repository, "someone.else@example.invalid", "Someone else", 10);
  });

  afterAll(async () => {
    clearCheckinCaches();
    await rm(temporaryRoot, { recursive: true, force: true });
  });

  test("returns only matching authors with per-commit details and no lockfile lines", async () => {
    const result = await scanCheckins([path.dirname(repository)]);

    expect(result.repositoriesScanned).toBe(1);
    expect(result.warnings).toEqual([]);
    expect(result.windowDays).toBe(365);
    expect(result.repositories.map((repo) => repo.name)).toEqual(["tracked-project"]);

    // Newest first: the noreply commit is +2 / -1, the first commit adds three lines.
    expect(result.commits.map((commit) => commit.subject)).toEqual([
      "Mine via noreply",
      "Mine",
    ]);
    expect(result.commits.map((commit) => [commit.added, commit.removed])).toEqual([
      [2, 1],
      [3, 0],
    ]);
    expect(new Set(result.commits.map((commit) => commit.repo))).toEqual(new Set([0]));
    expect(result.commits[0].at).toBeGreaterThanOrEqual(result.commits[1].at);
  });

  test("picks up new commits on the next, incremental scan", async () => {
    await writeFile(path.join(repository, "later.txt"), "later\n", "utf8");
    commitAs(repository, "a.d.schaerer@gmail.com", "Added later", 1);

    const result = await scanCheckins([path.dirname(repository)]);

    expect(result.commits.map((commit) => commit.subject)).toEqual([
      "Added later",
      "Mine via noreply",
      "Mine",
    ]);
  });
});
