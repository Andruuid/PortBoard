"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Folder,
  GitBranch,
  LoaderCircle,
  Radio,
  RefreshCw,
  ServerOff,
  SquareTerminal,
} from "lucide-react";

import { AppActions } from "@/components/app-actions";
import { RunningAppCard } from "@/components/running-app-card";
import { RuntimeBadge } from "@/components/runtime-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AppsResponse, RunningApp } from "@/lib/apps/types";

function DashboardSkeleton() {
  return (
    <Card className="border-border/80 bg-card/90 py-0">
      <CardContent className="space-y-4 p-5">
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex items-center gap-4 py-2">
            <Skeleton className="h-7 w-16" />
            <Skeleton className="h-5 w-40" />
            <Skeleton className="hidden h-5 flex-1 md:block" />
            <Skeleton className="h-8 w-32" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  return (
    <Card className="border-dashed border-border/80 bg-card/65">
      <CardContent className="flex min-h-72 flex-col items-center justify-center px-6 text-center">
        <div className="mb-5 rounded-2xl border border-border bg-muted/40 p-4">
          <ServerOff className="size-7 text-muted-foreground" aria-hidden="true" />
        </div>
        <h2 className="text-lg font-medium">No Node apps are listening</h2>
        <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
          Start a Next.js, Node.js, or Bun server under this Windows account and it
          will appear here automatically.
        </p>
      </CardContent>
    </Card>
  );
}

export function PortboardDashboard() {
  const [apps, setApps] = useState<RunningApp[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const requestRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (requestRef.current) {
      return;
    }

    const controller = new AbortController();
    requestRef.current = controller;
    setRefreshing(true);

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
      setWarnings(payload.warnings);
      setLastScan(payload.scannedAt);
      setError(null);
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === "AbortError") {
        return;
      }
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The Windows process scan failed.",
      );
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
      }
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => void refresh(), 0);

    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    }, 3_000);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearTimeout(initialRefresh);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      requestRef.current?.abort();
    };
  }, [refresh]);

  const scannedTime = lastScan
    ? new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(new Date(lastScan))
    : "Waiting for first scan";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1440px] flex-col px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
      <header className="mb-8 flex flex-col gap-6 lg:mb-10 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-4 flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-xl border border-primary/20 bg-primary/10 shadow-[0_0_24px_-8px_var(--primary)]">
              <SquareTerminal className="size-5 text-primary" aria-hidden="true" />
            </div>
            <Badge variant="outline" className="border-border/80 bg-background/60 font-mono text-muted-foreground">
              Windows local
            </Badge>
          </div>
          <h1 className="text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
            Portboard
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
            Your running JavaScript projects, their ports, and the context you
            forgot three terminals ago.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-9 items-center gap-2 rounded-lg border border-border/80 bg-card/70 px-3 text-xs text-muted-foreground">
            <span className="relative flex size-2">
              {!error && (
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              )}
              <span
                className={`relative inline-flex size-2 rounded-full ${error ? "bg-destructive" : "bg-emerald-400"}`}
              />
            </span>
            <span>{apps?.length ?? 0} listening</span>
            <span className="text-border">/</span>
            <span className="font-mono">{scannedTime}</span>
          </div>
          <Button
            variant="outline"
            size="lg"
            onClick={() => void refresh()}
            disabled={refreshing}
          >
            {refreshing ? (
              <LoaderCircle className="animate-spin" data-icon="inline-start" />
            ) : (
              <RefreshCw data-icon="inline-start" />
            )}
            Refresh
          </Button>
        </div>
      </header>

      {error && (
        <Alert variant="destructive" className="mb-5 bg-destructive/8">
          <AlertTriangle />
          <AlertTitle>Scan unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {warnings.length > 0 && (
        <Alert className="mb-5 bg-card/80">
          <AlertTriangle />
          <AlertTitle>Some process details were unavailable</AlertTitle>
          <AlertDescription>{warnings.join(" ")}</AlertDescription>
        </Alert>
      )}

      {apps === null ? (
        <DashboardSkeleton />
      ) : apps.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <Card className="hidden overflow-hidden border-border/80 bg-card/88 py-0 shadow-2xl shadow-black/20 md:block">
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="border-border/70 bg-muted/25 hover:bg-muted/25">
                    <TableHead className="w-28 pl-5">Port</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>Folder</TableHead>
                    <TableHead className="w-44">Git branch</TableHead>
                    <TableHead className="w-48 pr-5 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {apps.map((app) => (
                    <TableRow key={app.id} className="group border-border/60">
                      <TableCell className="pl-5">
                        <div className="flex items-center gap-2 font-mono text-base font-semibold text-primary">
                          <Radio className="size-3.5 text-emerald-400" aria-hidden="true" />
                          :{app.port}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex max-w-64 items-center gap-2">
                          <span className="truncate font-medium" title={app.projectName}>
                            {app.projectName}
                          </span>
                          <RuntimeBadge runtime={app.runtime} />
                          {app.confidence === "unidentified" && (
                            <Badge variant="outline" className="text-[0.65rem] text-amber-300">
                              Unidentified
                            </Badge>
                          )}
                        </div>
                        <span className="mt-1 block font-mono text-[0.68rem] text-muted-foreground">
                          PID {app.pid}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex max-w-[34rem] items-center gap-2 text-xs text-muted-foreground">
                          <Folder className="size-3.5 shrink-0" aria-hidden="true" />
                          <span
                            className="truncate font-mono"
                            title={app.projectRoot ?? "Unavailable"}
                          >
                            {app.projectRoot ?? "Project folder unavailable"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <GitBranch className="size-3.5" aria-hidden="true" />
                          <span className="max-w-32 truncate font-mono" title={app.gitBranch ?? "No Git branch"}>
                            {app.gitBranch ?? "—"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="pr-5">
                        <AppActions app={app} onStopped={() => void refresh()} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="grid gap-3 md:hidden">
            {apps.map((app) => (
              <RunningAppCard
                key={app.id}
                app={app}
                onStopped={() => void refresh()}
              />
            ))}
          </div>
        </>
      )}

      <footer className="mt-auto pt-8 text-center font-mono text-[0.68rem] leading-5 text-muted-foreground/70">
        Only same-user Node.js and Bun listeners are shown. Portboard cannot close
        itself.
      </footer>
    </main>
  );
}
