export type AppRuntime = "next" | "node" | "bun";

export type IdentificationConfidence = "identified" | "unidentified";

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
  message: string;
}
