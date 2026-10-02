import "server-only";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_GIT_TIMEOUT_MS = 5_000;
const DEFAULT_GIT_MAX_BUFFER = 8 * 1024 * 1024;

export interface RunGitOptions {
  timeoutMs?: number;
  maxBuffer?: number;
}

export async function runGit(
  repository: string,
  argumentsList: string[],
  options: RunGitOptions = {},
): Promise<string> {
  const { stdout } = await execFileAsync(
    "git.exe",
    ["-C", repository, ...argumentsList],
    {
      encoding: "utf8",
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      maxBuffer: options.maxBuffer ?? DEFAULT_GIT_MAX_BUFFER,
      timeout: options.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS,
      windowsHide: true,
    },
  );
  return stdout;
}

export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await operation(values[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.min(concurrency, values.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
