import path from "node:path";

import { describe, expect, test } from "vitest";

import {
  buildAppsFromSnapshot,
  extractWindowsPaths,
  selectRunnerProcess,
  type RawProcess,
  type WindowsSnapshot,
} from "@/lib/apps/windows-scanner";

const createdAt = "2026-07-10T08:00:00.000Z";

function processInfo(
  processId: number,
  parentProcessId: number,
  name: string,
  commandLine: string,
): RawProcess {
  return {
    processId,
    parentProcessId,
    name,
    commandLine,
    executablePath: name === "node.exe" ? "C:\\Program Files\\nodejs\\node.exe" : null,
    createdAt,
  };
}

describe("Windows listener discovery", () => {
  test("extracts quoted and unquoted Windows paths", () => {
    const paths = extractWindowsPaths(
      '"C:\\Program Files\\nodejs\\node.exe" C:\\Code\\demo\\server.mjs --port 3000',
    );

    expect(paths).toContain("C:\\Program Files\\nodejs\\node.exe");
    expect(paths).toContain("C:\\Code\\demo\\server.mjs");
  });

  test("selects the Next.js runner without crossing the command shell", () => {
    const listener = processInfo(
      30,
      20,
      "node.exe",
      "C:\\Code\\demo\\node_modules\\next\\dist\\server\\lib\\start-server.js",
    );
    const nextRunner = processInfo(
      20,
      10,
      "node.exe",
      '"C:\\Code\\demo\\node_modules\\next\\dist\\bin\\next" dev',
    );
    const commandShell = processInfo(10, 1, "cmd.exe", "cmd.exe /c next dev");

    expect(selectRunnerProcess([listener, nextRunner, commandShell]).processId).toBe(20);
  });

  test("deduplicates addresses, enriches package metadata, and sorts by port", async () => {
    const projectRoot = path.resolve("tests", "fixtures", "sample-node-app");
    const script = path.join(projectRoot, "server.mjs");
    const first = processInfo(501, 1, "node.exe", `node "${script}"`);
    const second = processInfo(502, 1, "node.exe", `node "${script}"`);
    const snapshot: WindowsSnapshot = {
      currentIdentity: "WORKSTATION\\developer",
      listeners: [
        { localAddress: "0.0.0.0", localPort: 4100, owningProcess: 501 },
        { localAddress: "127.0.0.1", localPort: 4100, owningProcess: 501 },
        { localAddress: "127.0.0.1", localPort: 3100, owningProcess: 502 },
      ],
      processes: [first, second],
      owners: {
        "501": "WORKSTATION\\developer",
        "502": "WORKSTATION\\developer",
      },
    };

    const apps = await buildAppsFromSnapshot(snapshot, {
      protectedPid: -1,
      skipProtocolProbe: true,
    });

    expect(apps).toHaveLength(2);
    expect(apps.map((app) => app.port)).toEqual([3100, 4100]);
    expect(apps[0].projectName).toBe("portboard-disposable-fixture");
    expect(apps[1].listeningAddress).toBe("127.0.0.1");
    expect(apps[1].confidence).toBe("identified");
  });

  test("excludes the protected process and unresolved Codex helpers", async () => {
    const protectedProcess = processInfo(601, 1, "node.exe", "node server.js");
    const helper: RawProcess = {
      ...processInfo(602, 1, "node.exe", "node C:\\Temp\\.tmpABC\\kernel.js --session-id test"),
      executablePath:
        "C:\\Users\\developer\\AppData\\Local\\OpenAI\\Codex\\runtimes\\cua_node\\bin\\node.exe",
    };
    const snapshot: WindowsSnapshot = {
      currentIdentity: "WORKSTATION\\developer",
      listeners: [
        { localAddress: "127.0.0.1", localPort: 5100, owningProcess: 601 },
        { localAddress: "127.0.0.1", localPort: 5200, owningProcess: 602 },
      ],
      processes: [protectedProcess, helper],
      owners: {
        "601": "WORKSTATION\\developer",
        "602": "WORKSTATION\\developer",
      },
    };

    await expect(
      buildAppsFromSnapshot(snapshot, {
        protectedPid: 601,
        skipProtocolProbe: true,
      }),
    ).resolves.toEqual([]);
  });
});
