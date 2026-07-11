import path from "node:path";

import { describe, expect, test } from "vitest";

import {
  buildAppsFromSnapshot,
  extractWindowsPaths,
  parseManagedCommands,
  selectRunnerProcess,
  selectStopTarget,
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

  test("selects a same-user project-local concurrently supervisor across npm wrappers", () => {
    const projectRoot = path.resolve("tests", "fixtures", "sample-node-app");
    const listener = processInfo(90, 80, "node.exe", `${projectRoot}\\server.mjs`);
    const next = processInfo(
      80,
      70,
      "node.exe",
      `${projectRoot}\\node_modules\\next\\dist\\bin\\next dev`,
    );
    const nextShell = processInfo(70, 60, "cmd.exe", "cmd.exe /c next dev");
    const npm = processInfo(60, 50, "node.exe", "npm-cli.js run next:dev");
    const npmShell = processInfo(50, 40, "cmd.exe", "cmd.exe /c npm run next:dev");
    const concurrently = processInfo(
      40,
      30,
      "node.exe",
      `${projectRoot}\\node_modules\\concurrently\\dist\\bin\\concurrently.js -n next,worker,evidence,research --restart-tries 10`,
    );
    const terminal = processInfo(30, 1, "powershell.exe", "powershell.exe -NoExit");
    const ancestry = [listener, next, nextShell, npm, npmShell, concurrently, terminal];
    const owners = Object.fromEntries(
      ancestry.map((process) => [String(process.processId), "WORKSTATION\\developer"]),
    );

    const selection = selectStopTarget(
      ancestry,
      projectRoot,
      owners,
      "WORKSTATION\\developer",
    );

    expect(selection.process.processId).toBe(40);
    expect(selection.supervision).toEqual({
      kind: "supervised",
      supervisorName: "concurrently",
      managedCommands: ["next", "worker", "evidence", "research"],
      restartLikely: true,
    });
    expect(parseManagedCommands(concurrently.commandLine!, "concurrently")).toEqual([
      "next",
      "worker",
      "evidence",
      "research",
    ]);
  });

  test("does not expand to an unverified or protected supervisor", () => {
    const projectRoot = path.resolve("tests", "fixtures", "sample-node-app");
    const listener = processInfo(190, 180, "node.exe", `${projectRoot}\\server.mjs`);
    const next = processInfo(180, 170, "node.exe", `${projectRoot}\\node_modules\\next\\next.js`);
    const supervisor = processInfo(
      170,
      160,
      "node.exe",
      `${projectRoot}\\node_modules\\concurrently\\dist\\bin\\concurrently.js -n web,worker`,
    );
    const terminal = processInfo(160, 1, "powershell.exe", "powershell.exe");
    const owners = {
      "190": "WORKSTATION\\developer",
      "180": "WORKSTATION\\developer",
      "170": "OTHER\\user",
    };

    const foreign = selectStopTarget(
      [listener, next, supervisor, terminal],
      projectRoot,
      owners,
      "WORKSTATION\\developer",
    );
    expect(foreign.process.processId).toBe(180);
    expect(foreign.supervision).toMatchObject({
      kind: "direct",
      restartLikely: true,
    });

    const protectedSelection = selectStopTarget(
      [listener, next, supervisor, terminal],
      projectRoot,
      { ...owners, "170": "WORKSTATION\\developer" },
      "WORKSTATION\\developer",
      new Set([170]),
    );
    expect(protectedSelection.process.processId).toBe(180);

    const globalSupervisor = {
      ...supervisor,
      commandLine:
        "C:\\Users\\developer\\AppData\\Roaming\\npm\\node_modules\\concurrently\\dist\\bin\\concurrently.js",
    };
    const globalSelection = selectStopTarget(
      [listener, next, globalSupervisor, terminal],
      projectRoot,
      { ...owners, "170": "WORKSTATION\\developer" },
      "WORKSTATION\\developer",
    );
    expect(globalSelection.process.processId).toBe(180);
    expect(globalSelection.supervision.kind).toBe("direct");

    const beyondTerminal = selectStopTarget(
      [listener, next, terminal, supervisor],
      projectRoot,
      { ...owners, "170": "WORKSTATION\\developer" },
      "WORKSTATION\\developer",
    );
    expect(beyondTerminal.process.processId).toBe(180);
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

  test("groups affected ports beneath the same verified supervisor", async () => {
    const projectRoot = path.resolve("tests", "fixtures", "sample-node-app");
    const supervisor = processInfo(
      900,
      1,
      "node.exe",
      `${projectRoot}\\node_modules\\concurrently\\dist\\bin\\concurrently.js -n web,worker`,
    );
    const web = processInfo(901, 900, "node.exe", `node ${projectRoot}\\server.mjs`);
    const worker = processInfo(902, 900, "node.exe", `node ${projectRoot}\\worker.mjs`);
    const snapshot: WindowsSnapshot = {
      currentIdentity: "WORKSTATION\\developer",
      listeners: [
        { localAddress: "127.0.0.1", localPort: 3000, owningProcess: 901 },
        { localAddress: "127.0.0.1", localPort: 4100, owningProcess: 902 },
      ],
      processes: [web, worker, supervisor],
      owners: {
        "900": "WORKSTATION\\developer",
        "901": "WORKSTATION\\developer",
        "902": "WORKSTATION\\developer",
      },
    };

    const apps = await buildAppsFromSnapshot(snapshot, {
      protectedPid: -1,
      skipProtocolProbe: true,
    });

    expect(apps).toHaveLength(2);
    expect(apps.every((app) => app.supervision.kind === "supervised")).toBe(true);
    expect(apps.every((app) => app.allPorts.join(",") === "3000,4100")).toBe(true);
    expect(apps.every((app) => app.stopTargetPid === 900)).toBe(true);
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

  test("identifies MailDev ports, the primary Next app, and an internal build channel", async () => {
    const projectRoot = path.resolve("tests", "fixtures", "sample-node-app");
    const maildev = processInfo(
      701,
      1,
      "node.exe",
      `"node" "${projectRoot}\\node_modules\\maildev\\bin\\maildev" --ip 127.0.0.1 --smtp 1025 --web 1080`,
    );
    const next = processInfo(
      801,
      1,
      "node.exe",
      `"node" "${projectRoot}\\node_modules\\next\\dist\\server\\lib\\start-server.js"`,
    );
    const postcss = processInfo(
      802,
      801,
      "node.exe",
      `"node" "${projectRoot}\\.next\\dev\\build\\postcss.js" 63178`,
    );
    const snapshot: WindowsSnapshot = {
      currentIdentity: "WORKSTATION\\developer",
      listeners: [
        { localAddress: "127.0.0.1", localPort: 1025, owningProcess: 701 },
        { localAddress: "127.0.0.1", localPort: 1080, owningProcess: 701 },
        { localAddress: "127.0.0.1", localPort: 3001, owningProcess: 801 },
        { localAddress: "127.0.0.1", localPort: 63178, owningProcess: 801 },
      ],
      processes: [maildev, next, postcss],
      owners: {
        "701": "WORKSTATION\\developer",
        "801": "WORKSTATION\\developer",
      },
    };

    const apps = await buildAppsFromSnapshot(snapshot, {
      protectedPid: -1,
      skipProtocolProbe: true,
    });
    const byPort = new Map(apps.map((item) => [item.port, item]));

    expect(byPort.get(1025)?.portInfo.kind).toBe("smtp");
    expect(byPort.get(1025)?.portInfo.canOpen).toBe(false);
    expect(byPort.get(1025)?.runtime).toBe("node");
    expect(byPort.get(1080)?.portInfo.kind).toBe("mail-web");
    expect(byPort.get(3001)?.portInfo).toMatchObject({
      kind: "primary-web",
      isPrimary: true,
    });
    expect(byPort.get(63178)?.portInfo.kind).toBe("internal");
  });
});
