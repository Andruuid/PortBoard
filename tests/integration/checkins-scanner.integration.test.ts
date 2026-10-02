import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { scanCheckins } from "@/lib/git/checkins-scanner";

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

function commitAs(repository: string, email: string, message: string) {
  git(repository, ["add", "."]);
  git(repository, ["commit", "-m", message], {
    GIT_AUTHOR_NAME: "Fixture Author",
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: "Fixture Author",
    GIT_COMMITTER_EMAIL: email,
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
    commitAs(repository, "a.d.schaerer@gmail.com", "Mine");

    await writeFile(path.join(repository, "mine.txt"), "one\nthree\nfour\nfive\n", "utf8");
    commitAs(repository, "123+andruuid@users.noreply.github.com", "Mine via noreply");

    await writeFile(path.join(repository, "other.txt"), "x\ny\n", "utf8");
    commitAs(repository, "someone.else@example.invalid", "Someone else");
  });

  afterAll(async () => {
    await rm(temporaryRoot, { recursive: true, force: true });
  });

  test("counts only matching authors and excludes lockfile lines", async () => {
    const result = await scanCheckins([path.dirname(repository)]);

    expect(result.repositoriesScanned).toBe(1);
    expect(result.warnings).toEqual([]);
    expect(result.days).toHaveLength(30);
    // 3 lines, then +2 / -1 on the same file; the other author and the lockfile are ignored.
    expect(result.totals).toEqual({ commits: 2, added: 5, removed: 1 });
    expect(result.days[29].commits).toBe(2);
  });
});
