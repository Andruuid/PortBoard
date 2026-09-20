import { spawn } from "node:child_process";
import { describe, expect, test } from "vitest";

function spawnOnce(command: string, args: string[], options: object = {}) {
  return new Promise<number>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "ignore",
      windowsHide: true,
      ...options,
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

describe("Windows npm spawn used by scripts/launch.mjs", () => {
  test.skipIf(process.platform !== "win32")(
    "npm.cmd without a shell is rejected with EINVAL",
    async () => {
      await expect(spawnOnce("npm.cmd", ["--version"])).rejects.toMatchObject({
        code: "EINVAL",
      });
    },
  );

  test.skipIf(process.platform !== "win32")(
    "npm as a single shell command string succeeds",
    async () => {
      await expect(spawnOnce("npm --version", [], { shell: true })).resolves.toBe(0);
    },
  );
});
