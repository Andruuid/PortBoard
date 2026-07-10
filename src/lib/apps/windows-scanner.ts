import "server-only";

import { createHmac, randomBytes } from "node:crypto";
import { execFile, spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import path from "node:path";
import { promisify } from "node:util";

import type { AppRuntime, RunningApp } from "@/lib/apps/types";

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
  runnerPid: number;
  runnerStartedAt: string | null;
}

export interface ScanOptions {
  protectedPid?: number;
  skipProtocolProbe?: boolean;
}

interface CandidateApp {
  listener: RawListener;
  process: RawProcess;
  ancestry: RawProcess[];
  runner: RawProcess;
  projectRoot: string | null;
  runtime: AppRuntime;
  groupKey: string;
}

interface ProjectMetadata {
  name: string | null;
  branch: string | null;
}

declare global {
  var __portboardFingerprintSecret: Buffer | undefined;
}

const protocolCache = new Map<string, { expiresAt: number; protocol: string }>();
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

function classifyRuntime(processInfo: RawProcess, ancestry: RawProcess[]): AppRuntime {
  if (processInfo.name.toLowerCase() === "bun.exe") {
    return "bun";
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

async function getOpenUrl(
  address: string,
  port: number,
  skipProbe: boolean,
): Promise<string> {
  const host = getProbeHost(address);
  const cacheKey = `${host}:${port}`;
  const cached = protocolCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return `${cached.protocol}://${formatUrlHost(host)}:${port}`;
  }

  let protocol = "http";
  if (!skipProbe && !(await tryProtocol("http", host, port))) {
    if (await tryProtocol("https", host, port)) {
      protocol = "https";
    }
  }

  protocolCache.set(cacheKey, {
    protocol,
    expiresAt: Date.now() + PROTOCOL_CACHE_TTL_MS,
  });
  return `${protocol}://${formatUrlHost(host)}:${port}`;
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

    const runner = selectRunnerProcess(ancestry);
    if (protectedAncestry.has(runner.processId)) {
      continue;
    }

    const projectRoot = findProjectRoot(ancestry);
    if (!projectRoot && isInternalCodexHelper(ancestry)) {
      continue;
    }

    candidates.push({
      listener,
      process: processInfo,
      ancestry,
      runner,
      projectRoot,
      runtime: classifyRuntime(processInfo, ancestry),
      groupKey: `${runner.processId}:${runner.createdAt ?? "unknown"}`,
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

      return {
        id: createFingerprint(candidate.process, candidate.listener.localPort),
        port: candidate.listener.localPort,
        url: await getOpenUrl(
          candidate.listener.localAddress,
          candidate.listener.localPort,
          options.skipProtocolProbe ?? false,
        ),
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
        runnerPid: candidate.runner.processId,
        runnerStartedAt: candidate.runner.createdAt,
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
  const { runnerPid, runnerStartedAt, ...publicApp } = app;
  void runnerPid;
  void runnerStartedAt;
  return publicApp;
}
