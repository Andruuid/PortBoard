import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  discoverGitRepositories,
  parsePorcelainStatus,
} from "@/lib/git/uncommitted-scanner";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("uncommitted repository discovery", () => {
  test("finds repositories and worktrees while pruning caches and links", async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "portboard-discovery-"));
    temporaryDirectories.push(temporaryRoot);
    const scanRoot = path.join(temporaryRoot, "projects");
    const repository = path.join(scanRoot, "repository");
    const worktree = path.join(scanRoot, "group", "worktree");
    const prunedRepository = path.join(scanRoot, "node_modules", "dependency");
    const hiddenRepository = path.join(scanRoot, ".hidden", "repository");
    const linkedRepository = path.join(temporaryRoot, "outside-repository");

    await mkdir(path.join(repository, ".git"), { recursive: true });
    await mkdir(worktree, { recursive: true });
    await writeFile(path.join(worktree, ".git"), "gitdir: elsewhere", "utf8");
    await mkdir(path.join(prunedRepository, ".git"), { recursive: true });
    await mkdir(path.join(hiddenRepository, ".git"), { recursive: true });
    await mkdir(path.join(linkedRepository, ".git"), { recursive: true });
    await symlink(linkedRepository, path.join(scanRoot, "linked"), "junction");

    const result = await discoverGitRepositories([scanRoot]);

    expect(result.repositories).toEqual(
      [worktree, repository].sort((left, right) =>
        left.localeCompare(right, undefined, { sensitivity: "base" }),
      ),
    );
    expect(result.warnings).toEqual([]);
  });

  test("parses staged, modified, untracked, conflicted, and renamed records", () => {
    const result = parsePorcelainStatus(
      [
        " M modified.ts",
        "M  staged.ts",
        "?? new.ts",
        "UU conflict.ts",
        "R  renamed.ts",
        "old-name.ts",
        "",
      ].join("\0"),
    );

    expect(result.counts).toEqual({
      total: 5,
      staged: 2,
      modified: 1,
      untracked: 1,
      conflicted: 1,
    });
    expect(result.paths).toEqual([
      "modified.ts",
      "staged.ts",
      "new.ts",
      "conflict.ts",
      "renamed.ts",
      "old-name.ts",
    ]);
  });
});
