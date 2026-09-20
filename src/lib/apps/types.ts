export type AppRuntime = "next" | "node" | "bun";

export type IdentificationConfidence = "identified" | "unidentified";

export type AppPortRoleKind =
  | "primary-web"
  | "web"
  | "mail-web"
  | "smtp"
  | "internal"
  | "service";

export interface AppPortInfo {
  kind: AppPortRoleKind;
  label: string;
  description: string;
  isPrimary: boolean;
  canOpen: boolean;
}

export interface AppSupervision {
  kind: "direct" | "supervised";
  supervisorName: string | null;
  managedCommands: string[];
  restartLikely: boolean;
}

export interface RunningApp {
  id: string;
  port: number;
  url: string;
  pid: number;
  projectName: string;
  projectRoot: string | null;
  gitBranch: string | null;
  runtime: AppRuntime;
  confidence: IdentificationConfidence;
  allPorts: number[];
  startedAt: string | null;
  listeningAddress: string;
  portInfo: AppPortInfo;
  supervision: AppSupervision;
}

export interface AppsResponse {
  apps: RunningApp[];
  scannedAt: string;
  warnings: string[];
}

export interface CloseAppResponse {
  stopped: boolean;
  forced: boolean;
  releasedPorts: number[];
  stopScope: "app" | "managed-stack";
  replacementDetected: boolean;
  message: string;
}

export type WorkerRuntime = "node" | "bun";

export interface BackgroundWorker {
  id: string;
  pid: number;
  projectName: string;
  projectRoot: string;
  gitBranch: string | null;
  runtime: WorkerRuntime;
  scriptName: string | null;
  startedAt: string | null;
  processCount: number;
  outboundConnections: number;
  remoteEndpoints: string[];
}

export interface WorkersResponse {
  workers: BackgroundWorker[];
  scannedAt: string;
  warnings: string[];
}

export interface StopWorkerResponse {
  stopped: boolean;
  forced: boolean;
  stoppedProcesses: number;
  message: string;
}
