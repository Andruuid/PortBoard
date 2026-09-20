import "server-only";

import path from "node:path";

import type { BackgroundWorker } from "@/lib/apps/types";
import {
  createFingerprint,
  findProjectRoot,
  getProcessAncestry,
  getProjectMetadata,
  isInternalCodexHelper,
  isRuntimeProcess,
  readWindowsSnapshot,
  type RawProcess,
  type ScanOptions,
  type WindowsSnapshot,
} from "@/lib/apps/windows-scanner";

const TOOLING_ROOT_PATTERNS = [
  /\\npm-cache\\/i,
  /\\_npx\\/i,
  /\\\.vscode\\extensions\\/i,
  /\\\.vscode-server\\/i,
  /\\microsoft vs code\\/i,
  /\\appdata\\local\\programs\\/i,
  /\\appdata\\roaming\\npm\\/i,
];
const SCRIPT_TOKEN_PATTERN = /[\w.-]+\.(?:ts|tsx|mjs|cjs|js)\b/gi;
const SHIM_SCRIPT_NAMES = new Set([
  "cli.js",
  "cli.mjs",
  "npm-cli.js",
  "npx-cli.js",
  "index.js",
  "index.mjs",
  "main.js",
  "bin.js",
  "loader.mjs",
  "register.js",
  "esbuild.js",
]);
const MAX_REMOTE_ENDPOINTS = 3;

export interface ScannedBackgroundWorker extends BackgroundWorker {
  stopTargetPid: number;
  stopTargetStartedAt: string | null;
  stopTargetOwner: string;
}

function isToolingRoot(projectRoot: string): boolean {
  return TOOLING_ROOT_PATTERNS.some((pattern) => pattern.test(projectRoot));
}

// Command lines routinely carry API keys, so only the bare script name is ever
// derived from them - the raw string never reaches the client.
export function extractScriptName(commandLine: string | null): string | null {
  const matches = commandLine?.match(SCRIPT_TOKEN_PATTERN);
  if (!matches) {
    return null;
  }

  const names = matches.map((match) => path.win32.basename(match));
  const meaningful = names.filter(
    (name) => !SHIM_SCRIPT_NAMES.has(name.toLowerCase()),
  );
  const preferred = meaningful.length > 0 ? meaningful : names;

  return preferred[preferred.length - 1] ?? null;
}

function collectTree(
  childrenByParent: Map<number, RawProcess[]>,
  rootPid: number,
): RawProcess[] {
  const tree: RawProcess[] = [];
  const queue = [rootPid];
  const visited = new Set<number>([rootPid]);

  while (queue.length > 0 && tree.length < 512) {
    const currentPid = queue.shift();
    if (currentPid === undefined) {
      continue;
    }

    for (const child of childrenByParent.get(currentPid) ?? []) {
      if (visited.has(child.processId)) {
        continue;
      }
      visited.add(child.processId);
      tree.push(child);
      queue.push(child.processId);
    }
  }

  return tree;
}

export function buildWorkersFromSnapshot(
  snapshot: WindowsSnapshot,
  options: ScanOptions = {},
): ScannedBackgroundWorker[] {
  const protectedPid = options.protectedPid ?? process.pid;
  const processById = new Map(
    snapshot.processes.map((processInfo) => [processInfo.processId, processInfo]),
  );
  const listenerPids = new Set(
    snapshot.listeners.map((listener) => listener.owningProcess),
  );
  const currentIdentity = snapshot.currentIdentity.toLowerCase();

  // A listener's ancestors own that listening app as surely as the listener
  // itself does - stopping a launcher would take its server down with it.
  const listenerTreePids = new Set<number>();
  for (const listenerPid of listenerPids) {
    for (const ancestor of getProcessAncestry(processById, listenerPid)) {
      listenerTreePids.add(ancestor.processId);
    }
  }

  const childrenByParent = new Map<number, RawProcess[]>();
  for (const processInfo of snapshot.processes) {
    const siblings = childrenByParent.get(processInfo.parentProcessId) ?? [];
    siblings.push(processInfo);
    childrenByParent.set(processInfo.parentProcessId, siblings);
  }

  const connectionsByPid = new Map<number, { remote: string }[]>();
  for (const connection of snapshot.connections ?? []) {
    const existing = connectionsByPid.get(connection.owningProcess) ?? [];
    existing.push({
      remote: `${connection.remoteAddress}:${connection.remotePort}`,
    });
    connectionsByPid.set(connection.owningProcess, existing);
  }

  const candidates = new Map<number, { process: RawProcess; projectRoot: string }>();

  for (const processInfo of snapshot.processes) {
    if (
      !isRuntimeProcess(processInfo) ||
      listenerTreePids.has(processInfo.processId)
    ) {
      continue;
    }

    const owner = snapshot.owners[String(processInfo.processId)]?.toLowerCase();
    if (!owner || owner !== currentIdentity) {
      continue;
    }

    const ancestry = getProcessAncestry(processById, processInfo.processId);

    // Anything under a listener already appears on the Running tab, and
    // Portboard must never offer to stop its own process tree.
    if (
      ancestry.some(
        (item) =>
          listenerPids.has(item.processId) ||
          (protectedPid > 0 && item.processId === protectedPid),
      )
    ) {
      continue;
    }

    if (isInternalCodexHelper(ancestry)) {
      continue;
    }

    const projectRoot = findProjectRoot(ancestry);
    if (!projectRoot || isToolingRoot(projectRoot)) {
      continue;
    }

    candidates.set(processInfo.processId, { process: processInfo, projectRoot });
  }

  const roots = [...candidates.values()].filter(({ process: processInfo }) => {
    const ancestry = getProcessAncestry(processById, processInfo.processId);
    return !ancestry
      .slice(1)
      .some((ancestor) => candidates.has(ancestor.processId));
  });

  const workers = roots.map(
    ({ process: processInfo, projectRoot }): ScannedBackgroundWorker => {
    const tree = collectTree(childrenByParent, processInfo.processId);
    const metadata = getProjectMetadata(projectRoot);
    const remoteEndpoints = new Set<string>();
    let outboundConnections = 0;

    for (const member of [processInfo, ...tree]) {
      for (const connection of connectionsByPid.get(member.processId) ?? []) {
        outboundConnections += 1;
        remoteEndpoints.add(connection.remote);
      }
    }

    const scriptName =
      extractScriptName(processInfo.commandLine) ??
      tree.reduce<string | null>(
        (found, member) => found ?? extractScriptName(member.commandLine),
        null,
      );

    return {
      id: createFingerprint(processInfo, "worker"),
      pid: processInfo.processId,
      projectName: metadata.name ?? path.win32.basename(projectRoot),
      projectRoot,
      gitBranch: metadata.branch,
      runtime: processInfo.name.toLowerCase() === "bun.exe" ? "bun" : "node",
      scriptName,
      startedAt: processInfo.createdAt,
      processCount: tree.length + 1,
      outboundConnections,
      remoteEndpoints: [...remoteEndpoints].sort().slice(0, MAX_REMOTE_ENDPOINTS),
      stopTargetPid: processInfo.processId,
      stopTargetStartedAt: processInfo.createdAt,
      stopTargetOwner: snapshot.owners[String(processInfo.processId)] ?? "",
    };
  },
  );

  return workers.sort(
    (left, right) =>
      left.projectName.localeCompare(right.projectName, undefined, {
        sensitivity: "base",
      }) ||
      (left.scriptName ?? "").localeCompare(right.scriptName ?? "") ||
      left.pid - right.pid,
  );
}

export async function scanBackgroundWorkers(
  options: ScanOptions = {},
): Promise<ScannedBackgroundWorker[]> {
  return buildWorkersFromSnapshot(await readWindowsSnapshot(), options);
}

export function toPublicWorker(worker: ScannedBackgroundWorker): BackgroundWorker {
  const { stopTargetPid, stopTargetStartedAt, stopTargetOwner, ...publicWorker } =
    worker;
  void stopTargetPid;
  void stopTargetStartedAt;
  void stopTargetOwner;
  return publicWorker;
}
