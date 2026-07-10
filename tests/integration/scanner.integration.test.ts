import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import net from "node:net";
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
});
