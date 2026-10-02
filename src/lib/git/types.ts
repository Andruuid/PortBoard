export interface ChangeCounts {
  total: number;
  staged: number;
  modified: number;
  untracked: number;
  conflicted: number;
}

export interface UncommittedProject {
  id: string;
  name: string;
  directory: string;
  branch: string;
  lastChangedAt: string;
  changes: ChangeCounts;
}

export interface GitScanWarning {
  directory: string;
  message: string;
}

export interface UncommittedResponse {
  projects: UncommittedProject[];
  scannedAt: string;
  roots: string[];
  warnings: GitScanWarning[];
}

export interface CheckinCommit {
  hash: string;
  /** Index into CheckinsResponse.repositories. */
  repo: number;
  /** Author date in epoch seconds. */
  at: number;
  added: number;
  removed: number;
  subject: string;
}

export interface CheckinRepository {
  name: string;
  directory: string;
}

export interface CheckinsResponse {
  commits: CheckinCommit[];
  repositories: CheckinRepository[];
  windowDays: number;
  repositoriesScanned: number;
  scannedAt: string;
  roots: string[];
  warnings: GitScanWarning[];
}

export interface OpenProjectResponse {
  opened: boolean;
  message: string;
}
