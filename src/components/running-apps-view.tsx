"use client";

import { Folder, GitBranch, Radio, ServerOff } from "lucide-react";

import { AppActions } from "@/components/app-actions";
import { RunningAppCard } from "@/components/running-app-card";
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
import type { RunningApp } from "@/lib/apps/types";

interface RunningAppsViewProps {
  apps: RunningApp[] | null;
  onStopped: () => void;
}

function RunningAppsSkeleton() {
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

function NoRunningApps() {
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

export function RunningAppsView({ apps, onStopped }: RunningAppsViewProps) {
  if (apps === null) {
    return <RunningAppsSkeleton />;
  }

  if (apps.length === 0) {
    return <NoRunningApps />;
  }

  return (
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
                        <Badge
                          variant="outline"
                          className="text-[0.65rem] text-amber-300"
                        >
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
                      <span
                        className="max-w-32 truncate font-mono"
                        title={app.gitBranch ?? "No Git branch"}
                      >
                        {app.gitBranch ?? "—"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="pr-5">
                    <AppActions app={app} onStopped={onStopped} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:hidden">
        {apps.map((app) => (
          <RunningAppCard key={app.id} app={app} onStopped={onStopped} />
        ))}
      </div>
    </>
  );
}
