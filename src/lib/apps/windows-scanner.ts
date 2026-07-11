import "server-only";

import { createHmac, randomBytes } from "node:crypto";
import { execFile, spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import path from "node:path";
import { promisify } from "node:util";

import type {
  AppPortInfo,
  AppRuntime,
  AppSupervision,
  RunningApp,
} from "@/lib/apps/types";

const execFileAsync = promisify(execFile);
const SCAN_SCRIPT = path.join(process.cwd(), "scripts", "scan-listeners.ps1");
const RUNTIME_NAMES = new Set(["node.exe", "bun.exe"]);
const SHELL_NAMES = new Set([
  "cmd.exe",
  "powershell.exe",
  "pwsh.exe",
  "conhost.exe",
  "windowsterminal.exe",
]);
const RUNNER_PATTERN =
  /(?:\\|\/|\s)(?:next|vite|nodemon|tsx|ts-node-dev|webpack-dev-server|react-scripts|astro|nuxt|remix|serve|http-server)(?:\\|\/|\s|\.cmd|$)/i;
const HARD_STOP_BOUNDARIES = new Set([
  "powershell.exe",
  "pwsh.exe",
  "conhost.exe",
  "windowsterminal.exe",
  "code.exe",
  "codex.exe",
  "explorer.exe",
]);
const SUPERVISOR_PATTERNS = [
  { name: "concurrently", pattern: /\\concurrently\\/i },
  { name: "npm-run-all", pattern: /\\npm-run-all\\/i },
  { name: "nodemon", pattern: /\\nodemon\\/i },
  { name: "Turborepo", pattern: /\\turbo\\/i },
  { name: "Nx", pattern: /\\nx\\/i },
] as const;
const PROTOCOL_CACHE_TTL_MS = 30_000;
const PROJECT_CACHE_TTL_MS = 5_000;

interface RawListener {
  localAddress: string;
  localPort: number;
  owningProcess: number;
}

export interface RawProcess {
  processId: number;
  parentProcessId: number;
  name: string;
  executablePath: string | null;
  commandLine: string | null;
  createdAt: string | null;
}

export interface WindowsSnapshot {
  currentIdentity: string;
  listeners: RawListener[];
  processes: RawProcess[];
  owners: Record<string, string>;
}

export interface ScannedRunningApp extends RunningApp {
  stopTargetPid: number;
  stopTargetStartedAt: string | null;
  stopTargetOwner: string;
}

export interface ScanOptions {
  protectedPid?: number;
  skipProtocolProbe?: boolean;
}

interface CandidateApp {
  listener: RawListener;
  process: RawProcess;
  ancestry: RawProcess[];
  listenerRunner: RawProcess;
  stopTarget: RawProcess;
  supervision: AppSupervision;
  projectRoot: string | null;
  runtime: AppRuntime;
  groupKey: string;
}

export interface StopTargetSelection {
  process: RawProcess;
  supervision: AppSupervision;
}

interface ProjectMetadata {
  name: string | null;
  branch: string | null;
}

declare global {
  var __portboardFingerprintSecret: Buffer | undefined;
}

const protocolCache = new Map<
  string,
  { expiresAt: number; protocol: "http" | "https" | null }
>();
const projectCache = new Map<
  string,
  { expiresAt: number; metadata: ProjectMetadata }
>();

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === null || value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function getFingerprintSecret(): Buffer {
  if (process.env.PORTBOARD_SESSION_SECRET) {
    return Buffer.from(process.env.PORTBOARD_SESSION_SECRET, "base64url");
  }

  if (!globalThis.__portboardFingerprintSecret) {
    globalThis.__portboardFingerprintSecret = randomBytes(32);
  }

  return globalThis.__portboardFingerprintSecret;
}

function createFingerprint(process: RawProcess, port: number): string {
  return createHmac("sha256", getFingerprintSecret())
    .update(`${process.processId}|${process.createdAt ?? "unknown"}|${port}`)
    .digest("base64url");
}

export async function readWindowsSnapshot(): Promise<WindowsSnapshot> {
  if (process.platform !== "win32") {
    throw new Error("Portboard currently supports Windows only.");
  }

  const { stdout } = await execFileAsync(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      SCAN_SCRIPT,
    ],
    {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    },
  );

  const parsed = JSON.parse(stdout.trim()) as Omit<
    WindowsSnapshot,
    "listeners" | "processes"
  > & {
    listeners: RawListener | RawListener[] | null;
    processes: RawProcess | RawProcess[] | null;
  };

  return {
    currentIdentity: parsed.currentIdentity,
    listeners: asArray(parsed.listeners),
    processes: asArray(parsed.processes),
    owners: parsed.owners ?? {},
  };
}

export function getProcessAncestry(
  processById: Map<number, RawProcess>,
  startPid: number,
): RawProcess[] {
  const ancestry: RawProcess[] = [];
  const visited = new Set<number>();
  let currentPid = startPid;

  while (currentPid > 0 && !visited.has(currentPid) && ancestry.length < 64) {
    const current = processById.get(currentPid);
    if (!current) {
      break;
    }

    ancestry.push(current);
    visited.add(currentPid);
    currentPid = current.parentProcessId;
  }

  return ancestry;
}

function isRuntimeProcess(processInfo: RawProcess): boolean {
  return RUNTIME_NAMES.has(processInfo.name.toLowerCase());
}

export function selectRunnerProcess(ancestry: RawProcess[]): RawProcess {
  const listener = ancestry[0];
  if (!listener) {
    throw new Error("A listener process is required to select its runner.");
  }

  let runner = listener;

  for (const ancestor of ancestry.slice(1)) {
    const name = ancestor.name.toLowerCase();
    if (SHELL_NAMES.has(name)) {
      break;
    }

    if (!isRuntimeProcess(ancestor)) {
      break;
    }

    if (RUNNER_PATTERN.test(ancestor.commandLine ?? "")) {
      runner = ancestor;
      continue;
    }

    break;
  }

  return runner;
}

function normalizedProcessCommand(processInfo: RawProcess): string {
  return (processInfo.commandLine ?? "").replace(/[\\/]+/g, "\\");
}

function supervisorName(processInfo: RawProcess, projectRoot: string): string | null {
  const commandLine = normalizedProcessCommand(processInfo);
  const projectModules = `${path.win32.normalize(projectRoot).toLowerCase()}\\node_modules\\`;
  if (!commandLine.toLowerCase().includes(projectModules)) {
    return null;
  }

  return (
    SUPERVISOR_PATTERNS.find(({ pattern }) => pattern.test(commandLine))?.name ?? null
  );
}

export function parseManagedCommands(
  commandLine: string,
  supervisor: string,
): string[] {
  if (supervisor !== "concurrently") {
    return [];
  }

  const match = commandLine.match(
    /(?:^|\s)(?:-n|--names)(?:=|\s+)(?:"([^"]+)"|'([^']+)'|([^\s]+))/i,
  );
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function selectStopTarget(
  ancestry: RawProcess[],
  projectRoot: string | null,
  owners: Record<string, string>,
  currentIdentity: string,
  protectedPids: Set<number> = new Set(),
): StopTargetSelection {
  const listenerRunner = selectRunnerProcess(ancestry);
  const normalizedIdentity = currentIdentity.toLowerCase();
  const runnerOwner = owners[String(listenerRunner.processId)]?.toLowerCase();
  let process =
    runnerOwner === normalizedIdentity && !protectedPids.has(listenerRunner.processId)
      ? listenerRunner
      : ancestry[0];
  let detectedUnverifiedSupervisor = false;
  let selectedName: string | null = null;

  if (projectRoot) {
    for (const ancestor of ancestry.slice(1)) {
      if (HARD_STOP_BOUNDARIES.has(ancestor.name.toLowerCase())) {
        break;
      }

      const name = supervisorName(ancestor, projectRoot);
      if (!name) {
        continue;
      }

      const owner = owners[String(ancestor.processId)]?.toLowerCase();
      if (owner !== normalizedIdentity || protectedPids.has(ancestor.processId)) {
        detectedUnverifiedSupervisor = true;
        continue;
      }

      process = ancestor;
      selectedName = name;
    }
  }

  return {
    process,
    supervision: selectedName
      ? {
          kind: "supervised",
          supervisorName: selectedName,
          managedCommands: parseManagedCommands(
            process.commandLine ?? "",
            selectedName,
          ),
          restartLikely: true,
        }
      : {
          kind: "direct",
          supervisorName: null,
          managedCommands: [],
          restartLikely: detectedUnverifiedSupervisor,
        },
  };
}

function cleanExtractedPath(value: string): string {
  return value
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/[),;]+$/g, "");
}

export function extractWindowsPaths(commandLine: string): string[] {
  const matches = new Set<string>();
  const patterns = [
    /["']([A-Za-z]:\\[^"']+)["']/g,
    /([A-Za-z]:\\[^"\r\n]*?\.(?:mjs|cjs|js|tsx|ts|json|cmd|exe))/gi,
    /(?:^|\s)([A-Za-z]:\\[^\s"]+)/g,
  ];

  for (const pattern of patterns) {
    for (const match of commandLine.matchAll(pattern)) {
      const extracted = cleanExtractedPath(match[1] ?? match[0]);
      if (/^[A-Za-z]:\\/.test(extracted)) {
        matches.add(path.win32.normalize(extracted));
      }
    }
  }

  return [...matches];
}

function isSystemRuntimeRoot(candidate: string): boolean {
  const normalized = candidate.toLowerCase();
  const nodeInstall = path.win32
    .join(process.env.ProgramFiles ?? "C:\\Program Files", "nodejs")
    .toLowerCase();

  return (
    normalized === nodeInstall ||
    normalized.startsWith(`${nodeInstall}\\`) ||
    normalized.includes("\\appdata\\local\\openai\\codex\\runtimes\\")
  );
}

function directoryForCandidate(candidate: string): string {
  try {
    return statSync(candidate).isDirectory()
      ? candidate
      : path.win32.dirname(candidate);
  } catch {
    return path.win32.extname(candidate)
      ? path.win32.dirname(candidate)
      : candidate;
  }
}

function findNearestPackageRoot(startDirectory: string): string | null {
  let current = path.win32.normalize(startDirectory);

  while (current && current !== path.win32.dirname(current)) {
    if (existsSync(path.join(current, "package.json"))) {
      return isSystemRuntimeRoot(current) ? null : current;
    }
    current = path.win32.dirname(current);
  }

  return null;
}

export function findProjectRoot(ancestry: RawProcess[]): string | null {
  for (const processInfo of ancestry) {
    const values = [processInfo.commandLine, processInfo.executablePath].filter(
      (value): value is string => Boolean(value),
    );

    for (const value of values) {
      for (const candidatePath of extractWindowsPaths(value)) {
        const normalized = path.win32.normalize(candidatePath);
        const nodeModulesIndex = normalized
          .toLowerCase()
          .indexOf("\\node_modules\\");

        if (nodeModulesIndex > 0) {
          const packageRoot = normalized.slice(0, nodeModulesIndex);
          if (
            !isSystemRuntimeRoot(packageRoot) &&
            existsSync(path.join(packageRoot, "package.json"))
          ) {
            return packageRoot;
          }
        }

        const packageRoot = findNearestPackageRoot(
          directoryForCandidate(normalized),
        );
        if (packageRoot) {
          return packageRoot;
        }
      }
    }
  }

  return null;
}

function getProjectMetadata(projectRoot: string): ProjectMetadata {
  const cached = projectCache.get(projectRoot);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.metadata;
  }

  let name: string | null = null;
  try {
    const packageJson = JSON.parse(
      readFileSync(path.join(projectRoot, "package.json"), "utf8"),
    ) as { name?: unknown };
    name = typeof packageJson.name === "string" ? packageJson.name : null;
  } catch {
    // Folder name remains a useful fallback.
  }

  const branchResult = spawnSync(
    "git.exe",
    ["-C", projectRoot, "symbolic-ref", "--quiet", "--short", "HEAD"],
    { encoding: "utf8", windowsHide: true },
  );
  let branch = branchResult.status === 0 ? branchResult.stdout.trim() : null;

  if (!branch) {
    const detachedResult = spawnSync(
      "git.exe",
      ["-C", projectRoot, "rev-parse", "--short", "HEAD"],
      { encoding: "utf8", windowsHide: true },
    );
    branch = detachedResult.status === 0 ? detachedResult.stdout.trim() : null;
  }

  const metadata = { name, branch };
  projectCache.set(projectRoot, {
    expiresAt: Date.now() + PROJECT_CACHE_TTL_MS,
    metadata,
  });
  return metadata;
}

function isMailDevCommand(commandLine: string): boolean {
  const normalized = commandLine.replace(/[\\/]+/g, "\\");
  return /\\node_modules\\(?:\.bin\\\.\.\\)?maildev\\/i.test(normalized);
}

function classifyRuntime(processInfo: RawProcess, ancestry: RawProcess[]): AppRuntime {
  if (processInfo.name.toLowerCase() === "bun.exe") {
    return "bun";
  }

  if (isMailDevCommand(processInfo.commandLine ?? "")) {
    return "node";
  }

  const commandLines = ancestry
    .map((item) => item.commandLine ?? "")
    .join(" ")
    .toLowerCase();

  return commandLines.includes("\\node_modules\\next\\") ||
    commandLines.includes("next\\dist\\bin\\next") ||
    /\bnext(?:\.cmd)?\s+(?:dev|start)\b/.test(commandLines)
    ? "next"
    : "node";
}

function isInternalCodexHelper(ancestry: RawProcess[]): boolean {
  const details = ancestry
    .flatMap((item) => [item.executablePath ?? "", item.commandLine ?? ""])
    .join(" ")
    .toLowerCase();

  return (
    details.includes("\\appdata\\local\\openai\\codex\\runtimes\\") ||
    (/\\temp\\\.tmp[^\\]+\\kernel\.js/.test(details) &&
      details.includes("--session-id"))
  );
}

function preferredListener(
  current: RawListener | undefined,
  candidate: RawListener,
): RawListener {
  if (!current) {
    return candidate;
  }

  const rank = (address: string) => {
    if (address === "127.0.0.1" || address === "::1") return 3;
    if (address === "0.0.0.0" || address === "::") return 2;
    return 1;
  };

  return rank(candidate.localAddress) > rank(current.localAddress)
    ? candidate
    : current;
}

function getProbeHost(address: string): string {
  if (address === "0.0.0.0") return "127.0.0.1";
  if (address === "::") return "::1";
  return address;
}

function formatUrlHost(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}

function tryProtocol(
  protocol: "http" | "https",
  host: string,
  port: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const factory = protocol === "https" ? httpsRequest : httpRequest;
    const request = factory(
      {
        host,
        port,
        path: "/",
        method: "HEAD",
        timeout: 500,
        ...(protocol === "https" ? { rejectUnauthorized: false } : {}),
      },
      (response) => {
        response.resume();
        resolve(true);
      },
    );

    request.once("timeout", () => request.destroy());
    request.once("error", () => resolve(false));
    request.end();
  });
}

interface OpenTarget {
  url: string;
  protocol: "http" | "https" | null;
}

async function getOpenTarget(
  address: string,
  port: number,
  skipProbe: boolean,
): Promise<OpenTarget> {
  const host = getProbeHost(address);
  const cacheKey = `${host}:${port}`;
  const cached = protocolCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return {
      url: `${cached.protocol ?? "http"}://${formatUrlHost(host)}:${port}`,
      protocol: cached.protocol,
    };
  }

  let protocol: "http" | "https" | null = skipProbe ? "http" : null;
  if (!skipProbe && (await tryProtocol("http", host, port))) {
    protocol = "http";
  } else if (!skipProbe && (await tryProtocol("https", host, port))) {
    protocol = "https";
  }

  protocolCache.set(cacheKey, {
    protocol,
    expiresAt: Date.now() + PROTOCOL_CACHE_TTL_MS,
  });
  return {
    url: `${protocol ?? "http"}://${formatUrlHost(host)}:${port}`,
    protocol,
  };
}

function commandFlagPort(commandLine: string, flag: string): number | null {
  const match = commandLine.match(
    new RegExp(`(?:^|\\s)--${flag}(?:=|\\s+)(\\d+)(?:\\s|$)`, "i"),
  );
  return match ? Number.parseInt(match[1], 10) : null;
}

function isDescendantOf(
  processById: Map<number, RawProcess>,
  processInfo: RawProcess,
  ancestorPid: number,
): boolean {
  const visited = new Set<number>();
  let current = processInfo;

  while (current.parentProcessId > 0 && !visited.has(current.processId)) {
    if (current.parentProcessId === ancestorPid) {
      return true;
    }
    visited.add(current.processId);
    const parent = processById.get(current.parentProcessId);
    if (!parent) {
      return false;
    }
    current = parent;
  }

  return false;
}

function isNextInternalWorkerPort(
  candidate: CandidateApp,
  processes: RawProcess[],
  processById: Map<number, RawProcess>,
): boolean {
  const portPattern = new RegExp(`(?:^|\\s)${candidate.listener.localPort}(?:\\s|$)`);

  return processes.some((processInfo) => {
    const commandLine = processInfo.commandLine ?? "";
    return (
      isDescendantOf(processById, processInfo, candidate.process.processId) &&
      /\\.next\\dev\\build\\(?:postcss|webpack)\.js/i.test(commandLine) &&
      portPattern.test(commandLine)
    );
  });
}

function classifyPort(
  candidate: CandidateApp,
  protocol: OpenTarget["protocol"],
  processes: RawProcess[],
  processById: Map<number, RawProcess>,
): AppPortInfo {
  const commandLine = candidate.process.commandLine ?? "";
  const port = candidate.listener.localPort;

  if (isMailDevCommand(commandLine)) {
    if (commandFlagPort(commandLine, "smtp") === port) {
      return {
        kind: "smtp",
        label: "SMTP",
        description: "MailDev receiver for local test email; it has no browser page.",
        isPrimary: false,
        canOpen: false,
      };
    }
    if (commandFlagPort(commandLine, "web") === port) {
      return {
        kind: "mail-web",
        label: "Mail inbox",
        description: "MailDev browser inbox for previewing locally captured email.",
        isPrimary: false,
        canOpen: true,
      };
    }
  }

  if (
    candidate.runtime === "next" &&
    isNextInternalWorkerPort(candidate, processes, processById)
  ) {
    return {
      kind: "internal",
      label: "Build worker",
      description: "Temporary Next.js development channel used by PostCSS/build tooling.",
      isPrimary: false,
      canOpen: false,
    };
  }

  if (candidate.runtime === "next") {
    return {
      kind: "primary-web",
      label: "Primary app",
      description: "Main Next.js website for this development process.",
      isPrimary: true,
      canOpen: protocol !== null,
    };
  }

  if (protocol !== null) {
    return {
      kind: "web",
      label: "Web service",
      description: "HTTP or HTTPS service with a browser-accessible response.",
      isPrimary: false,
      canOpen: true,
    };
  }

  return {
    kind: "service",
    label: "Node service",
    description: "Non-HTTP Node.js or Bun listener; its exact purpose is unknown.",
    isPrimary: false,
    canOpen: false,
  };
}

export async function buildAppsFromSnapshot(
  snapshot: WindowsSnapshot,
  options: ScanOptions = {},
): Promise<ScannedRunningApp[]> {
  const protectedPid = options.protectedPid ?? process.pid;
  const processById = new Map(
    snapshot.processes.map((processInfo) => [processInfo.processId, processInfo]),
  );
  const protectedAncestry = new Set(
    protectedPid > 0
      ? getProcessAncestry(processById, protectedPid).map(
          (processInfo) => processInfo.processId,
        )
      : [],
  );
  const listenersByProcessAndPort = new Map<string, RawListener>();

  for (const listener of snapshot.listeners) {
    const key = `${listener.owningProcess}:${listener.localPort}`;
    listenersByProcessAndPort.set(
      key,
      preferredListener(listenersByProcessAndPort.get(key), listener),
    );
  }

  const currentIdentity = snapshot.currentIdentity.toLowerCase();
  const candidates: CandidateApp[] = [];

  for (const listener of listenersByProcessAndPort.values()) {
    const processInfo = processById.get(listener.owningProcess);
    if (!processInfo || !isRuntimeProcess(processInfo)) {
      continue;
    }

    const owner = snapshot.owners[String(processInfo.processId)]?.toLowerCase();
    if (!owner || owner !== currentIdentity) {
      continue;
    }

    const ancestry = getProcessAncestry(processById, processInfo.processId);
    if (protectedPid > 0 && ancestry.some((item) => item.processId === protectedPid)) {
      continue;
    }

    const projectRoot = findProjectRoot(ancestry);
    if (!projectRoot && isInternalCodexHelper(ancestry)) {
      continue;
    }

    const listenerRunner = selectRunnerProcess(ancestry);
    const stopSelection = selectStopTarget(
      ancestry,
      projectRoot,
      snapshot.owners,
      snapshot.currentIdentity,
      protectedAncestry,
    );
    if (
      protectedAncestry.has(listenerRunner.processId) ||
      protectedAncestry.has(stopSelection.process.processId)
    ) {
      continue;
    }

    const stopOwner = snapshot.owners[
      String(stopSelection.process.processId)
    ]?.toLowerCase();
    if (stopOwner !== currentIdentity) {
      continue;
    }

    candidates.push({
      listener,
      process: processInfo,
      ancestry,
      listenerRunner,
      stopTarget: stopSelection.process,
      supervision: stopSelection.supervision,
      projectRoot,
      runtime: classifyRuntime(processInfo, ancestry),
      groupKey: `${stopSelection.process.processId}:${stopSelection.process.createdAt ?? "unknown"}`,
    });
  }

  const groupPorts = new Map<string, Set<number>>();
  for (const candidate of candidates) {
    const ports = groupPorts.get(candidate.groupKey) ?? new Set<number>();
    ports.add(candidate.listener.localPort);
    groupPorts.set(candidate.groupKey, ports);
  }

  const apps = await Promise.all(
    candidates.map(async (candidate): Promise<ScannedRunningApp> => {
      const metadata = candidate.projectRoot
        ? getProjectMetadata(candidate.projectRoot)
        : { name: null, branch: null };
      const projectName =
        metadata.name ??
        (candidate.projectRoot
          ? path.win32.basename(candidate.projectRoot)
          : `${candidate.runtime === "bun" ? "Bun" : "Node"} process ${candidate.process.processId}`);
      const openTarget = await getOpenTarget(
        candidate.listener.localAddress,
        candidate.listener.localPort,
        options.skipProtocolProbe ?? false,
      );

      return {
        id: createFingerprint(candidate.process, candidate.listener.localPort),
        port: candidate.listener.localPort,
        url: openTarget.url,
        pid: candidate.process.processId,
        projectName,
        projectRoot: candidate.projectRoot,
        gitBranch: metadata.branch,
        runtime: candidate.runtime,
        confidence: candidate.projectRoot ? "identified" : "unidentified",
        allPorts: [...(groupPorts.get(candidate.groupKey) ?? [])].sort(
          (left, right) => left - right,
        ),
        startedAt: candidate.process.createdAt,
        listeningAddress: candidate.listener.localAddress,
        portInfo: classifyPort(
          candidate,
          openTarget.protocol,
          snapshot.processes,
          processById,
        ),
        supervision: candidate.supervision,
        stopTargetPid: candidate.stopTarget.processId,
        stopTargetStartedAt: candidate.stopTarget.createdAt,
        stopTargetOwner:
          snapshot.owners[String(candidate.stopTarget.processId)] ?? "",
      };
    }),
  );

  return apps.sort((left, right) => left.port - right.port || left.pid - right.pid);
}

export async function scanRunningApps(
  options: ScanOptions = {},
): Promise<ScannedRunningApp[]> {
  const snapshot = await readWindowsSnapshot();
  return buildAppsFromSnapshot(snapshot, options);
}

export function toPublicRunningApp(app: ScannedRunningApp): RunningApp {
  const {
    stopTargetPid,
    stopTargetStartedAt,
    stopTargetOwner,
    ...publicApp
  } = app;
  void stopTargetPid;
  void stopTargetStartedAt;
  void stopTargetOwner;
  return publicApp;
}
