"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  GitCommitHorizontal,
  LoaderCircle,
  RadioTower,
  RefreshCw,
  SquareTerminal,
} from "lucide-react";

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
import type { AppsResponse, RunningApp } from "@/lib/apps/types";
import type {
  GitScanWarning,
  UncommittedProject,
  UncommittedResponse,
} from "@/lib/git/types";

type DashboardView = "running" | "uncommitted";

const DEFAULT_GIT_ROOTS = ["C:\\Codex", "C:\\ClaudeCode"];

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function PortboardDashboard() {
  const [activeView, setActiveView] = useState<DashboardView>("running");

  const [apps, setApps] = useState<RunningApp[] | null>(null);
  const [appWarnings, setAppWarnings] = useState<string[]>([]);
  const [appsLastScan, setAppsLastScan] = useState<string | null>(null);
  const [appsError, setAppsError] = useState<string | null>(null);
  const [appsRefreshing, setAppsRefreshing] = useState(false);
  const appsRequestRef = useRef<AbortController | null>(null);

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

  const isRunningView = activeView === "running";
  const activeError = isRunningView ? appsError : gitError;
  const activeRefreshing = isRunningView ? appsRefreshing : gitRefreshing;
  const activeLastScan = isRunningView ? appsLastScan : gitLastScan;
  const activeCount = isRunningView ? (apps?.length ?? 0) : (projects?.length ?? 0);
  const activeCountLabel = isRunningView
    ? `${activeCount} listening`
    : `${activeCount} dirty`;
  const activeWarningMessages = isRunningView
    ? appWarnings
    : gitWarnings.map(
        (warning) => `${warning.directory}: ${warning.message}`,
      );
  const scannedTime = activeLastScan
    ? new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(new Date(activeLastScan))
    : "Waiting for first scan";

  const manualRefresh = isRunningView ? refreshRunning : refreshUncommitted;

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
            <AlertTitle>
              {isRunningView ? "Scan unavailable" : "Git scan unavailable"}
            </AlertTitle>
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
        <TabsContent value="uncommitted" className="mt-3">
          <UncommittedProjectsView projects={projects} />
        </TabsContent>
      </Tabs>

      <footer className="mt-auto pt-8 text-center font-mono text-[0.68rem] leading-5 text-muted-foreground/70">
        {isRunningView
          ? "Only same-user Node.js and Bun listeners are shown. Portboard cannot close itself."
          : `Scanning ${gitRoots.join(" and ")}. Git-ignored files are excluded.`}
      </footer>
    </main>
  );
}
