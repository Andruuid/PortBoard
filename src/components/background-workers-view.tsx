"use client";

import { Activity, Clock3, Cpu, Folder, GitBranch, Layers3 } from "lucide-react";

import { WorkerActions, workerLabel } from "@/components/worker-actions";
import { RuntimeBadge } from "@/components/runtime-badge";
import { Badge } from "@/components/ui/badge";
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
import type { BackgroundWorker } from "@/lib/apps/types";

interface BackgroundWorkersViewProps {
  workers: BackgroundWorker[] | null;
  onStopped: () => void;
}

export function formatUptime(startedAt: string | null): string {
  if (!startedAt) {
    return "—";
  }

  const minutes = Math.floor((Date.now() - Date.parse(startedAt)) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 0) {
    return "—";
  }
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  return hours < 24
    ? `${hours}h ${minutes % 60}m`
    : `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function ActivityCell({ worker }: { worker: BackgroundWorker }) {
  if (worker.outboundConnections === 0) {
    return <span className="text-xs text-muted-foreground">Idle</span>;
  }

  const [first, ...rest] = worker.remoteEndpoints;

  return (
    <div className="flex min-w-0 items-center gap-2">
      <Activity className="size-3.5 shrink-0 text-amber-300" aria-hidden="true" />
      <span className="truncate font-mono text-xs text-amber-300">
        {first ?? `${worker.outboundConnections} open`}
        {rest.length > 0 ? ` +${rest.length}` : ""}
      </span>
    </div>
  );
}

function WorkersSkeleton() {
  return (
    <Card className="border-border/80 bg-card/90 py-0">
      <CardContent className="space-y-4 p-5">
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex items-center gap-4 py-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="hidden h-5 flex-1 md:block" />
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-8 w-20" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function NoWorkers() {
  return (
    <Card className="border-dashed border-border/80 bg-card/65">
      <CardContent className="flex min-h-72 flex-col items-center justify-center px-6 text-center">
        <div className="mb-5 rounded-2xl border border-border bg-muted/40 p-4">
          <Layers3 className="size-7 text-muted-foreground" aria-hidden="true" />
        </div>
        <h2 className="text-lg font-medium">No background workers are running</h2>
        <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
          This tab lists Node.js and Bun processes that belong to a project but
          hold no port, such as queue workers left behind by a checkout you no
          longer use.
        </p>
      </CardContent>
    </Card>
  );
}

function WorkerCard({
  worker,
  onStopped,
}: {
  worker: BackgroundWorker;
  onStopped: () => void;
}) {
  return (
    <Card className="border-border/80 bg-card/92 py-0 shadow-black/20">
      <CardContent className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="truncate font-mono text-sm font-semibold text-primary">
                {workerLabel(worker)}
              </span>
              <RuntimeBadge runtime={worker.runtime} />
              <Badge variant="outline" className="shrink-0 text-[0.65rem]">
                {worker.processCount} proc
              </Badge>
            </div>
            <h2 className="truncate font-medium">{worker.projectName}</h2>
          </div>
          <Cpu className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </div>

        <div className="space-y-2 text-xs text-muted-foreground">
          <ActivityCell worker={worker} />
          <div className="flex min-w-0 items-center gap-2">
            <Folder className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate font-mono" title={worker.projectRoot}>
              {worker.projectRoot}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <GitBranch className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="font-mono">{worker.gitBranch ?? "—"}</span>
            <Clock3 className="ml-auto size-3.5 shrink-0" aria-hidden="true" />
            <span className="font-mono" title={worker.startedAt ?? undefined}>
              {formatUptime(worker.startedAt)}
            </span>
          </div>
        </div>

        <WorkerActions worker={worker} onStopped={onStopped} />
      </CardContent>
    </Card>
  );
}

export function BackgroundWorkersView({
  workers,
  onStopped,
}: BackgroundWorkersViewProps) {
  if (workers === null) {
    return <WorkersSkeleton />;
  }

  if (workers.length === 0) {
    return <NoWorkers />;
  }

  return (
    <>
      <Card className="hidden overflow-hidden border-border/80 bg-card/88 py-0 shadow-2xl shadow-black/20 md:block">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-border/70 bg-muted/25 hover:bg-muted/25">
                <TableHead className="w-64 pl-5">Worker</TableHead>
                <TableHead className="w-56">Project</TableHead>
                <TableHead>Folder</TableHead>
                <TableHead className="w-48">Activity</TableHead>
                <TableHead className="w-28">Uptime</TableHead>
                <TableHead className="w-28 pr-5 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workers.map((worker) => (
                <TableRow
                  key={worker.id}
                  className="border-border/60 bg-background/20"
                >
                  <TableCell className="pl-5">
                    <div className="flex max-w-56 flex-wrap items-center gap-2">
                      <Cpu className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span
                        className="truncate font-mono font-medium"
                        title={workerLabel(worker)}
                      >
                        {workerLabel(worker)}
                      </span>
                      <RuntimeBadge runtime={worker.runtime} />
                    </div>
                    <span className="mt-1 block font-mono text-[0.68rem] text-muted-foreground">
                      PID {worker.pid} · {worker.processCount}{" "}
                      {worker.processCount === 1 ? "process" : "processes"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="block max-w-48 truncate font-medium" title={worker.projectName}>
                      {worker.projectName}
                    </span>
                    <span className="mt-1 flex items-center gap-1.5 text-[0.68rem] text-muted-foreground">
                      <GitBranch className="size-3" aria-hidden="true" />
                      <span className="max-w-32 truncate font-mono">
                        {worker.gitBranch ?? "—"}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex max-w-[30rem] items-center gap-2 text-xs text-muted-foreground">
                      <Folder className="size-3.5 shrink-0" aria-hidden="true" />
                      <span className="truncate font-mono" title={worker.projectRoot}>
                        {worker.projectRoot}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <ActivityCell worker={worker} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock3 className="size-3.5 shrink-0" aria-hidden="true" />
                      <span className="font-mono" title={worker.startedAt ?? undefined}>
                        {formatUptime(worker.startedAt)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="pr-5">
                    <WorkerActions worker={worker} onStopped={onStopped} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:hidden">
        {workers.map((worker) => (
          <WorkerCard key={worker.id} worker={worker} onStopped={onStopped} />
        ))}
      </div>
    </>
  );
}
