import path from "node:path";

import { describe, expect, test } from "vitest";

import {
  buildWorkersFromSnapshot,
  extractScriptName,
} from "@/lib/apps/worker-scanner";
import type { RawProcess, WindowsSnapshot } from "@/lib/apps/windows-scanner";

const IDENTITY = "WORKSTATION\\developer";
const ROOT = process.cwd();

function process_(overrides: Partial<RawProcess> & { processId: number }): RawProcess {
  return {
    parentProcessId: 0,
    name: "node.exe",
    executablePath: "C:\\Program Files\\nodejs\\node.exe",
    commandLine: null,
    createdAt: "2026-09-12T08:00:00.000Z",
    ...overrides,
  };
}

function snapshot(overrides: Partial<WindowsSnapshot> = {}): WindowsSnapshot {
  return {
    currentIdentity: IDENTITY,
    listeners: [],
    connections: [],
    processes: [],
    owners: {},
    ...overrides,
  };
}

function ownersFor(...pids: number[]): Record<string, string> {
  return Object.fromEntries(pids.map((pid) => [String(pid), IDENTITY]));
}

describe("background worker discovery", () => {
  test("collapses a shim, wrapper, and worker chain into one stoppable entry", () => {
    const wrapperCommand = `"node" "${path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs")}" "${path.join(ROOT, "scripts", "evidence-worker.ts")}"`;
    const workers = buildWorkersFromSnapshot(
      snapshot({
        processes: [
          // The npm shim resolves to npm's own package root, so it is not a
          // candidate and the wrapper below becomes the tree root.
          process_({
            processId: 100,
            parentProcessId: 10,
            commandLine: '"node" "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js" run evidence',
          }),
          process_({ processId: 200, parentProcessId: 100, commandLine: wrapperCommand }),
          process_({ processId: 300, parentProcessId: 200, commandLine: wrapperCommand }),
          process_({ processId: 400, parentProcessId: 300, name: "esbuild.exe" }),
        ],
        connections: [
          { owningProcess: 300, remoteAddress: "127.0.0.1", remotePort: 54321 },
          { owningProcess: 300, remoteAddress: "127.0.0.1", remotePort: 54321 },
        ],
        owners: ownersFor(100, 200, 300),
      }),
      { protectedPid: -1 },
    );

    expect(workers).toHaveLength(1);
    expect(workers[0]).toMatchObject({
      pid: 200,
      projectRoot: ROOT,
      scriptName: "evidence-worker.ts",
      runtime: "node",
      processCount: 3,
      outboundConnections: 2,
      remoteEndpoints: ["127.0.0.1:54321"],
    });
  });

  test("ignores processes belonging to an app that already holds a port", () => {
    const command = `"node" "${path.join(ROOT, "node_modules", "next", "dist", "bin", "next")}" dev`;
    const workers = buildWorkersFromSnapshot(
      snapshot({
        listeners: [
          { localAddress: "127.0.0.1", localPort: 3000, owningProcess: 500 },
        ],
        processes: [
          process_({ processId: 500, commandLine: command }),
          process_({ processId: 501, parentProcessId: 500, commandLine: command }),
        ],
        owners: ownersFor(500, 501),
      }),
      { protectedPid: -1 },
    );

    expect(workers).toEqual([]);
  });

  test("ignores a portless launcher whose child holds the port", () => {
    const command = `"node" "${path.join(ROOT, "scripts", "launch.mjs")}"`;
    const workers = buildWorkersFromSnapshot(
      snapshot({
        listeners: [
          { localAddress: "127.0.0.1", localPort: 43110, owningProcess: 801 },
        ],
        processes: [
          process_({ processId: 800, commandLine: command }),
          process_({ processId: 801, parentProcessId: 800, commandLine: command }),
        ],
        owners: ownersFor(800, 801),
      }),
      { protectedPid: -1 },
    );

    expect(workers).toEqual([]);
  });

  test("ignores runtimes owned by another Windows account", () => {
    const command = `"node" "${path.join(ROOT, "scripts", "evidence-worker.ts")}"`;
    const workers = buildWorkersFromSnapshot(
      snapshot({
        processes: [process_({ processId: 600, commandLine: command })],
        owners: { "600": "WORKSTATION\\someone-else" },
      }),
      { protectedPid: -1 },
    );

    expect(workers).toEqual([]);
  });
});

describe("script name extraction", () => {
  test("prefers the project entry point over runtime shims", () => {
    expect(
      extractScriptName(
        '"node" "C:\\p\\node_modules\\tsx\\dist\\cli.mjs" "C:\\p\\scripts\\pitch-worker.ts"',
      ),
    ).toBe("pitch-worker.ts");
  });

  test("falls back to a shim name when nothing else is present", () => {
    expect(
      extractScriptName('"node" "C:\\p\\node_modules\\.bin\\..\\thing\\cli.js"'),
    ).toBe("cli.js");
  });

  test("returns null when the command line names no script", () => {
    expect(extractScriptName("npm run evidence")).toBeNull();
    expect(extractScriptName(null)).toBeNull();
  });
});
