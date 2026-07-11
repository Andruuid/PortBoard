import { describe, expect, test } from "vitest";

import { evaluateStopState } from "@/lib/apps/service";
import type {
  ScannedRunningApp,
  WindowsSnapshot,
} from "@/lib/apps/windows-scanner";

function target(): ScannedRunningApp {
  return {
    id: "fingerprint",
    port: 3000,
    url: "http://127.0.0.1:3000",
    pid: 300,
    projectName: "fixture",
    projectRoot: "C:\\Code\\fixture",
    gitBranch: "main",
    runtime: "next",
    confidence: "identified",
    allPorts: [3000, 4100],
    startedAt: "2026-07-11T08:00:01.000Z",
    listeningAddress: "127.0.0.1",
    portInfo: {
      kind: "primary-web",
      label: "Primary app",
      description: "Main app.",
      isPrimary: true,
      canOpen: true,
    },
    supervision: {
      kind: "supervised",
      supervisorName: "concurrently",
      managedCommands: ["web", "worker"],
      restartLikely: true,
    },
    stopTargetPid: 200,
    stopTargetStartedAt: "2026-07-11T08:00:00.000Z",
    stopTargetOwner: "WORKSTATION\\developer",
  };
}

function snapshot(overrides: Partial<WindowsSnapshot> = {}): WindowsSnapshot {
  return {
    currentIdentity: "WORKSTATION\\developer",
    listeners: [],
    processes: [],
    owners: {},
    ...overrides,
  };
}

describe("stop verification", () => {
  test("detects a replacement PID that immediately reoccupies an expected port", () => {
    const state = evaluateStopState(
      target(),
      snapshot({
        listeners: [
          { localAddress: "127.0.0.1", localPort: 3000, owningProcess: 999 },
        ],
      }),
    );

    expect(state.targetStillExists).toBe(false);
    expect(state.replacementDetected).toBe(true);
    expect(state.releasedPorts).toEqual([4100]);
  });

  test("only treats the same PID, creation time, and owner as the verified target", () => {
    const process = {
      processId: 200,
      parentProcessId: 1,
      name: "node.exe",
      executablePath: "C:\\Program Files\\nodejs\\node.exe",
      commandLine: "node supervisor.js",
      createdAt: "2026-07-11T08:00:00.000Z",
    };
    const verified = evaluateStopState(
      target(),
      snapshot({
        processes: [process],
        owners: { "200": "WORKSTATION\\developer" },
      }),
    );
    const reused = evaluateStopState(
      target(),
      snapshot({
        processes: [{ ...process, createdAt: "2026-07-11T09:00:00.000Z" }],
        owners: { "200": "WORKSTATION\\developer" },
      }),
    );

    expect(verified.targetStillExists).toBe(true);
    expect(reused.targetStillExists).toBe(false);
  });
});
