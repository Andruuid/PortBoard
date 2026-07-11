import "server-only";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type {
  AppsResponse,
  CloseAppResponse,
  RunningApp,
} from "@/lib/apps/types";
import {
  scanRunningApps,
  readWindowsSnapshot,
  toPublicRunningApp,
  type ScanOptions,
  type ScannedRunningApp,
} from "@/lib/apps/windows-scanner";

const execFileAsync = promisify(execFile);
const SCAN_CACHE_TTL_MS = 1_000;

interface CachedScan {
  expiresAt: number;
  apps: ScannedRunningApp[];
}

export interface CloseServiceResult {
  status: number;
  body: CloseAppResponse;
}

interface CommandFailure extends Error {
  stdout?: string;
  stderr?: string;
}

let cachedScan: CachedScan | null = null;
let scanInFlight: Promise<ScannedRunningApp[]> | null = null;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function getScannedApps(force = false): Promise<ScannedRunningApp[]> {
  if (!force && cachedScan && cachedScan.expiresAt > Date.now()) {
    return cachedScan.apps;
  }

  if (!force && scanInFlight) {
    return scanInFlight;
  }

  const operation = scanRunningApps();
  if (!force) {
    scanInFlight = operation;
  }

  try {
    const apps = await operation;
    cachedScan = {
      apps,
      expiresAt: Date.now() + SCAN_CACHE_TTL_MS,
    };
    return apps;
  } finally {
    if (!force) {
      scanInFlight = null;
    }
  }
}

export async function getAppsResponse(): Promise<AppsResponse> {
  const apps = await getScannedApps();
  return {
    apps: apps.map(toPublicRunningApp),
    scannedAt: new Date().toISOString(),
    warnings: [],
  };
}

async function terminateProcessTree(
  processId: number,
  force: boolean,
): Promise<{ output: string; failed: boolean }> {
  const argumentsList = ["/PID", String(processId), "/T"];
  if (force) {
    argumentsList.push("/F");
  }

  try {
    const result = await execFileAsync("taskkill.exe", argumentsList, {
      encoding: "utf8",
      windowsHide: true,
    });
    return { output: `${result.stdout}\n${result.stderr}`.trim(), failed: false };
  } catch (error) {
    const failure = error as CommandFailure;
    return {
      output: `${failure.stdout ?? ""}\n${failure.stderr ?? failure.message}`.trim(),
      failed: true,
    };
  }
}

function releasedPorts(
  expectedPorts: number[],
  occupiedPorts: Set<number>,
): number[] {
  return expectedPorts.filter((port) => !occupiedPorts.has(port));
}

function stopScope(target: ScannedRunningApp): "app" | "managed-stack" {
  return target.supervision.kind === "supervised" ? "managed-stack" : "app";
}

export function evaluateStopState(
  target: ScannedRunningApp,
  snapshot: Awaited<ReturnType<typeof readWindowsSnapshot>>,
): {
  targetStillExists: boolean;
  occupiedPorts: Set<number>;
  releasedPorts: number[];
  replacementDetected: boolean;
} {
  const processInfo = target.stopTargetStartedAt
    ? snapshot.processes.find(
    (process) => process.processId === target.stopTargetPid,
      )
    : undefined;
  const currentOwner = snapshot.owners[String(target.stopTargetPid)];
  const targetStillExists = Boolean(
    processInfo &&
      processInfo.createdAt === target.stopTargetStartedAt &&
      (!currentOwner ||
        currentOwner.toLowerCase() === target.stopTargetOwner.toLowerCase()),
  );
  const occupiedPorts = new Set(snapshot.listeners.map((listener) => listener.localPort));
  const freedPorts = releasedPorts(target.allPorts, occupiedPorts);

  return {
    targetStillExists,
    occupiedPorts,
    releasedPorts: freedPorts,
    replacementDetected: target.allPorts.some((port) => occupiedPorts.has(port)),
  };
}

export async function closeRunningApp(
  id: string,
  options: ScanOptions = {},
): Promise<CloseServiceResult> {
  const initialApps = await scanRunningApps({
    ...options,
    skipProtocolProbe: true,
  });
  const target = initialApps.find((app) => app.id === id);

  if (!target) {
    return {
      status: 409,
      body: {
        stopped: false,
        forced: false,
        releasedPorts: [],
        stopScope: "app",
        replacementDetected: false,
        message: "This app is no longer running or its process identity changed.",
      },
    };
  }

  const scope = stopScope(target);
  const normalAttempt = await terminateProcessTree(target.stopTargetPid, false);
  await delay(2_000);

  let verificationSnapshot = await readWindowsSnapshot();
  let stopState = evaluateStopState(target, verificationSnapshot);
  let forced = false;
  let forceAttempt: Awaited<ReturnType<typeof terminateProcessTree>> | null = null;

  if (stopState.targetStillExists) {
    forced = true;
    forceAttempt = await terminateProcessTree(target.stopTargetPid, true);
    await delay(650);
    verificationSnapshot = await readWindowsSnapshot();
    stopState = evaluateStopState(target, verificationSnapshot);
  }

  cachedScan = null;
  const { targetStillExists, occupiedPorts, releasedPorts: freedPorts, replacementDetected } =
    stopState;

  if (!targetStillExists && !replacementDetected) {
    return {
      status: 200,
      body: {
        stopped: true,
        forced,
        releasedPorts: freedPorts,
        stopScope: scope,
        replacementDetected: false,
        message: forced
          ? `${target.projectName} required a force-stop and is no longer running.`
          : scope === "managed-stack"
            ? `${target.projectName}'s managed development stack stopped successfully.`
            : `${target.projectName} stopped successfully.`,
      },
    };
  }

  const output = `${normalAttempt.output}\n${forceAttempt?.output ?? ""}`;
  const accessDenied = /access is denied|access denied/i.test(output);

  return {
    status: accessDenied ? 403 : 500,
    body: {
      stopped: false,
      forced,
      releasedPorts: freedPorts,
      stopScope: scope,
      replacementDetected,
      message: replacementDetected && !targetStillExists
        ? `Port ${target.allPorts.find((port) => occupiedPorts.has(port))} was immediately reoccupied by a replacement process. The app appears to have restarted.`
        : accessDenied
        ? "Windows denied permission to stop this process. It may be running as administrator."
        : normalAttempt.failed || forceAttempt?.failed
          ? "Windows could not stop the verified process tree."
          : "The process still owns its port after the stop attempt.",
    },
  };
}

export function sortRunningApps(apps: RunningApp[]): RunningApp[] {
  return [...apps].sort(
    (left, right) => left.port - right.port || left.pid - right.pid,
  );
}
