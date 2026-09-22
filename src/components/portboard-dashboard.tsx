"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Cpu,
  GitCommitHorizontal,
  LoaderCircle,
  RadioTower,
  RefreshCw,
  SquareTerminal,
} from "lucide-react";

import { BackgroundWorkersView } from "@/components/background-workers-view";
import { RunningAppsView } from "@/components/running-apps-view";
import { UncommittedProjectsView } from "@/components/uncommitted-projects-view";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import type {
  AppsResponse,
  BackgroundWorker,
  RunningApp,
  WorkersResponse,
} from "@/lib/apps/types";
import type {
  GitScanWarning,
  UncommittedProject,
  UncommittedResponse,
} from "@/lib/git/types";

type DashboardView = "running" | "workers" | "uncommitted";

const DEFAULT_GIT_ROOTS = ["C:\\Codex", "C:\\ClaudeCode"];

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function PortboardDashboard() {
  const [activeView, setActiveView] = useState<DashboardView>("running");
  const [portboardPort, setPortboardPort] = useState<number | null>(null);

  const [apps, setApps] = useState<RunningApp[] | null>(null);
  const [appWarnings, setAppWarnings] = useState<string[]>([]);
  const [appsLastScan, setAppsLastScan] = useState<string | null>(null);
  const [appsError, setAppsError] = useState<string | null>(null);
  const [appsRefreshing, setAppsRefreshing] = useState(false);
  const appsRequestRef = useRef<AbortController | null>(null);

  const [workers, setWorkers] = useState<BackgroundWorker[] | null>(null);
  const [workerWarnings, setWorkerWarnings] = useState<string[]>([]);
  const [workersLastScan, setWorkersLastScan] = useState<string | null>(null);
  const [workersError, setWorkersError] = useState<string | null>(null);
  const [workersRefreshing, setWorkersRefreshing] = useState(false);
  const workersRequestRef = useRef<AbortController | null>(null);

  const [projects, setProjects] = useState<UncommittedProject[] | null>(null);
  const [gitWarnings, setGitWarnings] = useState<GitScanWarning[]>([]);
  const [gitRoots, setGitRoots] = useState<string[]>(DEFAULT_GIT_ROOTS);
  const [gitLastScan, setGitLastScan] = useState<string | null>(null);
  const [gitError, setGitError] = useState<string | null>(null);
  const [gitRefreshing, setGitRefreshing] = useState(false);
  const gitRequestRef = useRef<AbortController | null>(null);

  const refreshRunning = useCallback(async () => {
    if (appsRequestRef.current) {
      return;
    }

    const controller = new AbortController();
    appsRequestRef.current = controller;
    setAppsRefreshing(true);

    try {
      const response = await fetch("/api/apps", {
        cache: "no-store",
        signal: controller.signal,
      });
      const payload = (await response.json()) as AppsResponse & { message?: string };

      if (!response.ok) {
        throw new Error(payload.message ?? "The Windows process scan failed.");
      }

      setApps(
        [...payload.apps].sort(
          (left, right) => left.port - right.port || left.pid - right.pid,
        ),
      );
      setAppWarnings(payload.warnings);
      setAppsLastScan(payload.scannedAt);
      setAppsError(null);
    } catch (requestError) {
      if (!isAbortError(requestError)) {
        setAppsError(
          requestError instanceof Error
            ? requestError.message
            : "The Windows process scan failed.",
        );
      }
    } finally {
      if (appsRequestRef.current === controller) {
        appsRequestRef.current = null;
        setAppsRefreshing(false);
      }
    }
  }, []);

  const refreshWorkers = useCallback(async () => {
    if (workersRequestRef.current) {
      return;
    }

    const controller = new AbortController();
    workersRequestRef.current = controller;
    setWorkersRefreshing(true);

    try {
      const response = await fetch("/api/workers", {
        cache: "no-store",
        signal: controller.signal,
      });
      const payload = (await response.json()) as WorkersResponse & {
        message?: string;
      };

      if (!response.ok) {
        throw new Error(payload.message ?? "The background process scan failed.");
      }

      setWorkers(payload.workers);
      setWorkerWarnings(payload.warnings);
      setWorkersLastScan(payload.scannedAt);
      setWorkersError(null);
    } catch (requestError) {
      if (!isAbortError(requestError)) {
        setWorkersError(
          requestError instanceof Error
            ? requestError.message
            : "The background process scan failed.",
        );
      }
    } finally {
      if (workersRequestRef.current === controller) {
        workersRequestRef.current = null;
        setWorkersRefreshing(false);
      }
    }
  }, []);

  const refreshUncommitted = useCallback(async () => {
    if (gitRequestRef.current) {
      return;
    }

    const controller = new AbortController();
    gitRequestRef.current = controller;
    setGitRefreshing(true);

    try {
      const response = await fetch("/api/uncommitted", {
        cache: "no-store",
        signal: controller.signal,
      });
      const payload = (await response.json()) as UncommittedResponse & {
        message?: string;
      };

      if (!response.ok) {
        throw new Error(payload.message ?? "The Git repository scan failed.");
      }

      setProjects(
        [...payload.projects].sort(
          (left, right) =>
            Date.parse(right.lastChangedAt) - Date.parse(left.lastChangedAt) ||
            left.name.localeCompare(right.name),
        ),
      );
      setGitWarnings(payload.warnings);
      setGitRoots(payload.roots);
      setGitLastScan(payload.scannedAt);
      setGitError(null);
    } catch (requestError) {
      if (!isAbortError(requestError)) {
        setGitError(
          requestError instanceof Error
            ? requestError.message
            : "The Git repository scan failed.",
        );
      }
    } finally {
      if (gitRequestRef.current === controller) {
        gitRequestRef.current = null;
        setGitRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    if (activeView !== "running") {
      return;
    }

    const initialRefresh = window.setTimeout(() => void refreshRunning(), 0);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshRunning();
      }
    }, 3_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshRunning();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearTimeout(initialRefresh);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      appsRequestRef.current?.abort();
    };
  }, [activeView, refreshRunning]);

  useEffect(() => {
    if (activeView !== "workers") {
      return;
    }

    const initialRefresh = window.setTimeout(() => void refreshWorkers(), 0);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshWorkers();
      }
    }, 5_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshWorkers();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearTimeout(initialRefresh);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      workersRequestRef.current?.abort();
    };
  }, [activeView, refreshWorkers]);

  useEffect(() => {
    if (activeView !== "uncommitted") {
      return;
    }

    const initialRefresh = window.setTimeout(() => void refreshUncommitted(), 0);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshUncommitted();
      }
    }, 30_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshUncommitted();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearTimeout(initialRefresh);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      gitRequestRef.current?.abort();
    };
  }, [activeView, refreshUncommitted]);

  useEffect(() => {
    const fetchPortboardPort = async () => {
      try {
        const response = await fetch("/api/health", { cache: "no-store" });
        if (response.ok) {
          const data = (await response.json()) as { status: string; port: number };
          setPortboardPort(data.port);
        }
      } catch {
        // Port fetch is not critical, silently ignore errors
      }
    };
    void fetchPortboardPort();
  }, []);

  const view = {
    running: {
      error: appsError,
      refreshing: appsRefreshing,
      lastScan: appsLastScan,
      countLabel: `${apps?.length ?? 0} listening`,
      errorTitle: "Scan unavailable",
      warnings: appWarnings,
      footer:
        "Only same-user Node.js and Bun listeners are shown.",
    },
    workers: {
      error: workersError,
      refreshing: workersRefreshing,
      lastScan: workersLastScan,
      countLabel: `${workers?.length ?? 0} background`,
      errorTitle: "Background scan unavailable",
      warnings: workerWarnings,
      footer:
        "Same-user Node.js and Bun processes that hold no port and belong to no listening app.",
    },
    uncommitted: {
      error: gitError,
      refreshing: gitRefreshing,
      lastScan: gitLastScan,
      countLabel: `${projects?.length ?? 0} dirty`,
      errorTitle: "Git scan unavailable",
      warnings: gitWarnings.map(
        (warning) => `${warning.directory}: ${warning.message}`,
      ),
      footer: `Scanning ${gitRoots.join(" and ")}. Git-ignored files are excluded.`,
    },
  }[activeView];

  const activeError = view.error;
  const activeRefreshing = view.refreshing;
  const activeCountLabel = view.countLabel;
  const activeWarningMessages = view.warnings;
  const scannedTime = view.lastScan
    ? new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(new Date(view.lastScan))
    : "Waiting for first scan";

  const manualRefresh =
    activeView === "running"
      ? refreshRunning
      : activeView === "workers"
        ? refreshWorkers
        : refreshUncommitted;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1440px] flex-col px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
      <header className="mb-7 flex flex-col gap-6 lg:mb-8 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-4 flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-xl border border-primary/20 bg-primary/10 shadow-[0_0_24px_-8px_var(--primary)]">
              <SquareTerminal className="size-5 text-primary" aria-hidden="true" />
            </div>
            <Badge
              variant="outline"
              className="border-border/80 bg-background/60 font-mono text-muted-foreground"
            >
              Windows local
            </Badge>
            {portboardPort !== null && (
              <Badge
                variant="outline"
                className="border-emerald-500/30 bg-emerald-500/10 font-mono text-emerald-600 dark:text-emerald-400"
              >
                Running on port {portboardPort}
              </Badge>
            )}
          </div>
          <h1 className="text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
            Portboard
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
            Running development servers and unfinished Git work, without the
            terminal archaeology.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-9 items-center gap-2 rounded-lg border border-border/80 bg-card/70 px-3 text-xs text-muted-foreground">
            <span className="relative flex size-2">
              {!activeError && (
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              )}
              <span
                className={`relative inline-flex size-2 rounded-full ${activeError ? "bg-destructive" : "bg-emerald-400"}`}
              />
            </span>
            <span>{activeCountLabel}</span>
            <span className="text-border">/</span>
            <span className="font-mono">{scannedTime}</span>
          </div>
          <Button
            variant="outline"
            size="lg"
            onClick={() => void manualRefresh()}
            disabled={activeRefreshing}
          >
            {activeRefreshing ? (
              <LoaderCircle className="animate-spin" data-icon="inline-start" />
            ) : (
              <RefreshCw data-icon="inline-start" />
            )}
            Refresh
          </Button>
        </div>
      </header>

      <Tabs
        value={activeView}
        onValueChange={(value) => setActiveView(value as DashboardView)}
        className="flex-1"
      >
        <TabsList className="h-10 w-full justify-start border border-border/70 bg-card/65 p-1 sm:w-fit">
          <TabsTrigger value="running" className="h-8 min-w-32 px-3">
            <RadioTower data-icon="inline-start" />
            Running
            {apps !== null && (
              <span className="ml-1 font-mono text-[0.65rem] text-muted-foreground">
                {apps.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="workers" className="h-8 min-w-36 px-3">
            <Cpu data-icon="inline-start" />
            Background
            {workers !== null && (
              <span className="ml-1 font-mono text-[0.65rem] text-muted-foreground">
                {workers.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="uncommitted" className="h-8 min-w-36 px-3">
            <GitCommitHorizontal data-icon="inline-start" />
            Uncommitted
            {projects !== null && (
              <span className="ml-1 font-mono text-[0.65rem] text-muted-foreground">
                {projects.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {activeError && (
          <Alert variant="destructive" className="mt-3 bg-destructive/8">
            <AlertTriangle />
            <AlertTitle>{view.errorTitle}</AlertTitle>
            <AlertDescription>{activeError}</AlertDescription>
          </Alert>
        )}

        {activeWarningMessages.length > 0 && (
          <Alert className="mt-3 bg-card/80">
            <AlertTriangle />
            <AlertTitle>Some details were unavailable</AlertTitle>
            <AlertDescription>
              {activeWarningMessages.slice(0, 3).join(" ")}
              {activeWarningMessages.length > 3
                ? ` Plus ${activeWarningMessages.length - 3} more.`
                : ""}
            </AlertDescription>
          </Alert>
        )}

        <TabsContent value="running" className="mt-3">
          <RunningAppsView apps={apps} onStopped={() => void refreshRunning()} />
        </TabsContent>
        <TabsContent value="workers" className="mt-3">
          <BackgroundWorkersView
            workers={workers}
            onStopped={() => void refreshWorkers()}
          />
        </TabsContent>
        <TabsContent value="uncommitted" className="mt-3">
          <UncommittedProjectsView projects={projects} />
        </TabsContent>
      </Tabs>

      <footer className="mt-auto pt-8 text-center font-mono text-[0.68rem] leading-5 text-muted-foreground/70">
        {view.footer}
      </footer>
    </main>
  );
}
