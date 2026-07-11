import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { closeRunningApp } from "@/lib/apps/service";
import { scanRunningApps } from "@/lib/apps/windows-scanner";

const windowsDescribe = process.platform === "win32" ? describe : describe.skip;

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(800);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

windowsDescribe("Windows scanner integration", () => {
  let fixture: ChildProcessWithoutNullStreams;
  let fixturePort = 0;

  beforeAll(async () => {
    const script = path.resolve("tests", "fixtures", "sample-node-app", "server.mjs");
    fixture = spawn(process.execPath, [script], {
      env: { ...process.env, TEST_PORT: "0" },
      stdio: "pipe",
      windowsHide: true,
    });

    fixturePort = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Fixture server did not start.")), 5_000);
      fixture.stdout.setEncoding("utf8");
      fixture.stdout.on("data", (chunk: string) => {
        const match = chunk.match(/READY:(\d+)/);
        if (match) {
          clearTimeout(timeout);
          resolve(Number(match[1]));
        }
      });
      fixture.once("error", reject);
      fixture.once("exit", (code) => {
        if (!fixturePort) reject(new Error(`Fixture exited with code ${code}.`));
      });
    });
  });

  afterAll(() => {
    if (fixture?.pid && fixture.exitCode === null) {
      spawnSync("taskkill.exe", ["/PID", String(fixture.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    }
  });

  test("discovers and safely closes only the disposable fixture", async () => {
    const apps = await scanRunningApps({
      protectedPid: -1,
      skipProtocolProbe: true,
    });
    const fixtureApp = apps.find((app) => app.port === fixturePort);

    expect(fixtureApp).toBeDefined();
    expect(fixtureApp?.projectName).toBe("portboard-disposable-fixture");
    expect(fixtureApp?.projectRoot).toBe(
      path.resolve("tests", "fixtures", "sample-node-app"),
    );

    const staleResult = await closeRunningApp("not-a-valid-fingerprint", {
      protectedPid: -1,
    });
    expect(staleResult.status).toBe(409);
    expect(await canConnect(fixturePort)).toBe(true);

    const closeResult = await closeRunningApp(fixtureApp!.id, {
      protectedPid: -1,
    });
    expect(closeResult.status).toBe(200);
    expect(closeResult.body.stopped).toBe(true);
    expect(await canConnect(fixturePort)).toBe(false);
  });

  test(
    "stops a disposable project-local restart supervisor and its sibling",
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "portboard-supervised-"));
      const supervisorDirectory = path.join(
        root,
        "node_modules",
        "concurrently",
        "dist",
        "bin",
      );
      const serverScript = path.join(root, "server.mjs");
      const supervisorScript = path.join(supervisorDirectory, "concurrently.mjs");
      let supervisor: ChildProcessWithoutNullStreams | null = null;

      try {
        await mkdir(supervisorDirectory, { recursive: true });
        await writeFile(
          path.join(root, "package.json"),
          JSON.stringify({ name: "portboard-supervised-fixture", private: true, type: "module" }),
        );
        await writeFile(
          serverScript,
          `import http from "node:http";
const server = http.createServer((_request, response) => response.end("fixture"));
server.listen(Number(process.env.TEST_PORT || 0), "127.0.0.1", () => {
  const address = server.address();
  if (address && typeof address === "object") process.stdout.write("READY:" + address.port + "\\n");
});
`,
        );
        await writeFile(
          supervisorScript,
          `import { spawn } from "node:child_process";
import path from "node:path";
const sourcePath = new URL(import.meta.url).pathname.replace(/^\\/([A-Za-z]:)/, "$1");
const root = path.resolve(path.dirname(sourcePath), "../../../../");
const serverScript = path.join(root, "server.mjs");
let port = 0;
let stopping = false;
let child;
const sibling = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", windowsHide: true });
process.stdout.write("SIBLING:" + sibling.pid + "\\n");
function start() {
  child = spawn(process.execPath, [serverScript], { env: { ...process.env, TEST_PORT: String(port) }, stdio: ["ignore", "pipe", "inherit"], windowsHide: true });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    const match = chunk.match(/READY:(\\d+)/);
    if (match) { port = Number(match[1]); process.stdout.write("READY:" + port + "\\n"); }
  });
  child.once("exit", () => { if (!stopping) setTimeout(start, 250); });
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { stopping = true; child?.kill(); sibling.kill(); process.exit(0); });
start();
`,
        );

        supervisor = spawn(
          process.execPath,
          [supervisorScript, "-n", "web,worker", "--restart-tries", "10"],
          { stdio: "pipe", windowsHide: true },
        );
        const started = await new Promise<{ port: number; siblingPid: number }>(
          (resolve, reject) => {
            let output = "";
            let errorOutput = "";
            const timeout = setTimeout(
              () =>
                reject(
                  new Error(
                    `Supervised fixture did not start: ${errorOutput.trim()}`,
                  ),
                ),
              8_000,
            );
            supervisor!.stdout.setEncoding("utf8");
            supervisor!.stderr.setEncoding("utf8");
            supervisor!.stderr.on("data", (chunk: string) => {
              errorOutput += chunk;
            });
            supervisor!.stdout.on("data", (chunk: string) => {
              output += chunk;
              const ready = output.match(/READY:(\d+)/);
              const sibling = output.match(/SIBLING:(\d+)/);
              if (ready && sibling) {
                clearTimeout(timeout);
                resolve({ port: Number(ready[1]), siblingPid: Number(sibling[1]) });
              }
            });
            supervisor!.once("error", reject);
            supervisor!.once("exit", (code) => {
              clearTimeout(timeout);
              reject(
                new Error(
                  `Supervised fixture exited with code ${code}: ${errorOutput.trim()}`,
                ),
              );
            });
          },
        );

        const apps = await scanRunningApps({
          protectedPid: -1,
          skipProtocolProbe: true,
        });
        const supervisedApp = apps.find((app) => app.port === started.port);

        expect(supervisedApp?.supervision).toMatchObject({
          kind: "supervised",
          supervisorName: "concurrently",
          managedCommands: ["web", "worker"],
        });
        const result = await closeRunningApp(supervisedApp!.id, {
          protectedPid: -1,
        });

        expect(result.status).toBe(200);
        expect(result.body).toMatchObject({
          stopped: true,
          stopScope: "managed-stack",
          replacementDetected: false,
        });
        await new Promise((resolve) => setTimeout(resolve, 700));
        expect(await canConnect(started.port)).toBe(false);
        expect(() => process.kill(started.siblingPid, 0)).toThrow();
      } finally {
        if (supervisor?.pid && supervisor.exitCode === null) {
          spawnSync("taskkill.exe", ["/PID", String(supervisor.pid), "/T", "/F"], {
            stdio: "ignore",
            windowsHide: true,
          });
        }
        await rm(root, { recursive: true, force: true });
      }
    },
    30_000,
  );
});
