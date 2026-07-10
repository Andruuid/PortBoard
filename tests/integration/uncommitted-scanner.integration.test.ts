import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { scanUncommittedProjects } from "@/lib/git/uncommitted-scanner";

const windowsDescribe = process.platform === "win32" ? describe : describe.skip;

function git(repository: string, argumentsList: string[], allowFailure = false) {
  const result = spawnSync("git.exe", ["-C", repository, ...argumentsList], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error(result.stderr || `git ${argumentsList.join(" ")} failed`);
  }
  return result;
}

async function initializeRepository(
  root: string,
  name: string,
  packageName?: string,
) {
  const repository = path.join(root, name);
  await mkdir(repository, { recursive: true });
  git(repository, ["init", "-b", "main"]);
  git(repository, ["config", "user.email", "portboard@example.invalid"]);
  git(repository, ["config", "user.name", "Portboard Tests"]);
  await writeFile(path.join(repository, "tracked.txt"), "baseline\n", "utf8");
  await writeFile(path.join(repository, ".gitignore"), "ignored.log\n", "utf8");
  if (packageName) {
    await writeFile(
      path.join(repository, "package.json"),
      JSON.stringify({ name: packageName }),
      "utf8",
    );
  }
  git(repository, ["add", "."]);
  git(repository, ["commit", "-m", "Initial fixture"]);
  return repository;
}

windowsDescribe("uncommitted Git scanner integration", () => {
  let temporaryRoot = "";
  let scanRoot = "";
  let cleanRepository = "";
  let dirtyRepository = "";
  let detachedRepository = "";
  let conflictRepository = "";
  let newestDirtyFile = "";

  beforeAll(async () => {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "portboard-git-scan-"));
    scanRoot = path.join(temporaryRoot, "projects");
    await mkdir(scanRoot, { recursive: true });

    cleanRepository = await initializeRepository(scanRoot, "clean-project");

    dirtyRepository = await initializeRepository(
      scanRoot,
      "dirty-project",
      "fixture-dirty-package",
    );
    await writeFile(path.join(dirtyRepository, "tracked.txt"), "modified\n", "utf8");
    await writeFile(path.join(dirtyRepository, "deleted.txt"), "delete me\n", "utf8");
    git(dirtyRepository, ["add", "deleted.txt"]);
    git(dirtyRepository, ["commit", "-m", "Add deletion fixture"]);
    await unlink(path.join(dirtyRepository, "deleted.txt"));
    await writeFile(path.join(dirtyRepository, "staged.txt"), "staged\n", "utf8");
    git(dirtyRepository, ["add", "staged.txt"]);
    newestDirtyFile = path.join(dirtyRepository, "untracked.txt");
    await writeFile(newestDirtyFile, "untracked\n", "utf8");
    await writeFile(path.join(dirtyRepository, "ignored.log"), "ignored\n", "utf8");

    detachedRepository = await initializeRepository(scanRoot, "detached-project");
    git(detachedRepository, ["checkout", "--detach"]);
    await writeFile(path.join(detachedRepository, "detached-change.txt"), "dirty\n", "utf8");

    conflictRepository = await initializeRepository(scanRoot, "conflict-project");
    git(conflictRepository, ["checkout", "-b", "other"]);
    await writeFile(path.join(conflictRepository, "tracked.txt"), "other\n", "utf8");
    git(conflictRepository, ["add", "tracked.txt"]);
    git(conflictRepository, ["commit", "-m", "Other branch change"]);
    git(conflictRepository, ["checkout", "main"]);
    await writeFile(path.join(conflictRepository, "tracked.txt"), "main\n", "utf8");
    git(conflictRepository, ["add", "tracked.txt"]);
    git(conflictRepository, ["commit", "-m", "Main branch change"]);
    git(conflictRepository, ["merge", "other"], true);
  });

  afterAll(async () => {
    if (temporaryRoot) {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  test("returns only dirty repositories with metadata and accurate states", async () => {
    const missingRoot = path.join(temporaryRoot, "missing");
    const result = await scanUncommittedProjects([scanRoot, missingRoot]);

    expect(result.projects.some((project) => project.directory === cleanRepository)).toBe(false);
    expect(result.warnings).toContainEqual({
      directory: missingRoot,
      message: "Directory does not exist.",
    });

    const dirty = result.projects.find(
      (project) => project.directory === dirtyRepository,
    );
    expect(dirty).toBeDefined();
    expect(dirty?.name).toBe("fixture-dirty-package");
    expect(dirty?.branch).toBe("main");
    expect(dirty?.changes).toEqual({
      total: 4,
      staged: 1,
      modified: 2,
      untracked: 1,
      conflicted: 0,
    });
    expect(Date.parse(dirty!.lastChangedAt)).toBeGreaterThanOrEqual(
      (await stat(newestDirtyFile)).mtimeMs - 1_000,
    );

    const detached = result.projects.find(
      (project) => project.directory === detachedRepository,
    );
    expect(detached?.name).toBe("detached-project");
    expect(detached?.branch).toMatch(/^detached @ [0-9a-f]+$/);

    const conflicted = result.projects.find(
      (project) => project.directory === conflictRepository,
    );
    expect(conflicted?.changes.conflicted).toBe(1);

    expect(result.projects.map((project) => Date.parse(project.lastChangedAt))).toEqual(
      [...result.projects]
        .map((project) => Date.parse(project.lastChangedAt))
        .sort((left, right) => right - left),
    );
  });
});
