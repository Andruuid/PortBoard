"use client";

import {
  ChevronDown,
  ChevronRight,
  Folder,
  GitBranch,
  Layers3,
  Radio,
  ServerOff,
} from "lucide-react";
import { Fragment, useState } from "react";

import { AppActions } from "@/components/app-actions";
import { PortRoleBadge } from "@/components/port-role-badge";
import { RunningAppCard } from "@/components/running-app-card";
import { RuntimeBadge } from "@/components/runtime-badge";
import { SupervisionBadge } from "@/components/supervision-badge";
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
import type { RunningApp } from "@/lib/apps/types";

interface RunningAppsViewProps {
  apps: RunningApp[] | null;
  onStopped: () => void;
}

interface RunningAppGroup {
  key: string;
  apps: RunningApp[];
  projectRoot: string | null;
}

export function groupRunningApps(apps: RunningApp[]): RunningAppGroup[] {
  const groups = new Map<string, RunningAppGroup>();

  for (const app of apps) {
    const normalizedRoot = app.projectRoot
      ?.replace(/[\\/]+$/, "")
      .replace(/\//g, "\\")
      .toLowerCase();
    const key = normalizedRoot ? `folder:${normalizedRoot}` : `app:${app.id}`;
    const existing = groups.get(key);

    if (existing) {
      existing.apps.push(app);
    } else {
      groups.set(key, {
        key,
        apps: [app],
        projectRoot: app.projectRoot,
      });
    }
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      apps: [...group.apps].sort((left, right) => left.port - right.port),
    }))
    .sort((left, right) => {
      const leftApp = left.apps[0];
      const rightApp = right.apps[0];

      return (
        leftApp.projectName.localeCompare(rightApp.projectName, undefined, {
          sensitivity: "base",
        }) ||
        (left.projectRoot ?? "").localeCompare(right.projectRoot ?? "", undefined, {
          sensitivity: "base",
        }) ||
        leftApp.port - rightApp.port
      );
    });
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

function RunningAppRow({
  app,
  grouped = false,
  onStopped,
}: {
  app: RunningApp;
  grouped?: boolean;
  onStopped: () => void;
}) {
  return (
    <TableRow className="group border-border/60 bg-background/20">
      <TableCell className={grouped ? "pl-10" : "pl-5"}>
        <div className="flex flex-wrap items-center gap-2 font-mono text-base font-semibold text-primary">
          <Radio className="size-3.5 text-emerald-400" aria-hidden="true" />
          :{app.port}
          <PortRoleBadge portInfo={app.portInfo} />
        </div>
      </TableCell>
      <TableCell>
        <div className="flex max-w-64 items-center gap-2">
          <span className="truncate font-medium" title={app.projectName}>
            {app.projectName}
          </span>
          <RuntimeBadge runtime={app.runtime} />
          <SupervisionBadge supervision={app.supervision} />
          {app.confidence === "unidentified" && (
            <Badge variant="outline" className="text-[0.65rem] text-amber-300">
              Unidentified
            </Badge>
          )}
        </div>
        <span className="mt-1 block font-mono text-[0.68rem] text-muted-foreground">
          PID {app.pid}
        </span>
        {app.supervision.kind === "supervised" && (
          <span className="mt-1 block max-w-72 text-[0.68rem] leading-4 text-amber-300/80">
            The listener may restart unless its managed stack is stopped.
          </span>
        )}
        <span
          className="mt-1 block max-w-72 text-[0.68rem] leading-4 text-muted-foreground"
          title={app.portInfo.description}
        >
          {app.portInfo.description}
        </span>
      </TableCell>
      <TableCell>
        <div className="flex max-w-[34rem] items-center gap-2 text-xs text-muted-foreground">
          <Folder className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate font-mono" title={app.projectRoot ?? "Unavailable"}>
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
  );
}

export function RunningAppsView({ apps, onStopped }: RunningAppsViewProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set(),
  );

  if (apps === null) {
    return <RunningAppsSkeleton />;
  }

  if (apps.length === 0) {
    return <NoRunningApps />;
  }

  const groups = groupRunningApps(apps);

  function toggleGroup(key: string) {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  return (
    <>
      <Card className="hidden overflow-hidden border-border/80 bg-card/88 py-0 shadow-2xl shadow-black/20 md:block">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-border/70 bg-muted/25 hover:bg-muted/25">
                <TableHead className="w-48 pl-5">Port</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Folder</TableHead>
                <TableHead className="w-44">Git branch</TableHead>
                <TableHead className="w-48 pr-5 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group) => {
                if (group.apps.length === 1) {
                  return (
                    <RunningAppRow
                      key={group.apps[0].id}
                      app={group.apps[0]}
                      onStopped={onStopped}
                    />
                  );
                }

                const expanded = expandedGroups.has(group.key);
                const representative = group.apps[0];
                const primaryApp = group.apps.find((app) => app.portInfo.isPrimary);
                const runtimeKinds = [...new Set(group.apps.map((app) => app.runtime))];
                const label = `${representative.projectName} (${group.apps.length} ports)`;

                return (
                  <Fragment key={group.key}>
                    <TableRow className="border-border/70 bg-muted/20 hover:bg-muted/30">
                      <TableCell className="pl-5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="-ml-2 font-mono text-primary"
                          aria-expanded={expanded}
                          aria-label={`${expanded ? "Collapse" : "Expand"} ${label}`}
                          onClick={() => toggleGroup(group.key)}
                        >
                          {expanded ? (
                            <ChevronDown data-icon="inline-start" />
                          ) : (
                            <ChevronRight data-icon="inline-start" />
                          )}
                          {group.apps.length} ports
                        </Button>
                        <span className="block max-w-40 truncate font-mono text-[0.65rem] text-muted-foreground">
                          {group.apps.map((app) => `:${app.port}`).join(" · ")}
                        </span>
                        {primaryApp && (
                          <span className="mt-1 block font-mono text-[0.65rem] font-medium text-emerald-300">
                            Main :{primaryApp.port}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex max-w-64 items-center gap-2">
                          <Layers3 className="size-4 shrink-0 text-primary" aria-hidden="true" />
                          <span className="truncate font-medium" title={representative.projectName}>
                            {representative.projectName}
                          </span>
                          {runtimeKinds.map((runtime) => (
                            <RuntimeBadge key={runtime} runtime={runtime} />
                          ))}
                          <SupervisionBadge supervision={representative.supervision} />
                        </div>
                        <span className="mt-1 block text-[0.68rem] text-muted-foreground">
                          {group.apps
                            .map((app) => app.portInfo.label)
                            .filter((value, index, values) => values.indexOf(value) === index)
                            .join(" · ")}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex max-w-[34rem] items-center gap-2 text-xs text-muted-foreground">
                          <Folder className="size-3.5 shrink-0" aria-hidden="true" />
                          <span className="truncate font-mono" title={group.projectRoot ?? "Unavailable"}>
                            {group.projectRoot ?? "Project folder unavailable"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <GitBranch className="size-3.5" aria-hidden="true" />
                          <span className="max-w-32 truncate font-mono">
                            {representative.gitBranch ?? "—"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="pr-5 text-right text-xs text-muted-foreground">
                        {expanded ? "Expanded" : "Collapsed"}
                      </TableCell>
                    </TableRow>
                    {expanded &&
                      group.apps.map((app) => (
                        <RunningAppRow
                          key={app.id}
                          app={app}
                          grouped
                          onStopped={onStopped}
                        />
                      ))}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:hidden">
        {groups.map((group) => {
          if (group.apps.length === 1) {
            return (
              <RunningAppCard
                key={group.apps[0].id}
                app={group.apps[0]}
                onStopped={onStopped}
              />
            );
          }

          const expanded = expandedGroups.has(group.key);
          const representative = group.apps[0];
          const primaryApp = group.apps.find((app) => app.portInfo.isPrimary);
          const label = `${representative.projectName} (${group.apps.length} ports)`;

          return (
            <div key={group.key} className="min-w-0 space-y-2">
              <Card className="border-primary/20 bg-card/92 py-0 shadow-black/20">
                <CardContent className="p-4">
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-auto min-w-0 w-full justify-start gap-3 whitespace-normal p-0 text-left hover:bg-transparent"
                    aria-expanded={expanded}
                    aria-label={`${expanded ? "Collapse" : "Expand"} ${label}`}
                    onClick={() => toggleGroup(group.key)}
                  >
                    <div className="grid size-9 shrink-0 place-items-center rounded-lg border border-primary/20 bg-primary/8 text-primary">
                      <Layers3 className="size-4" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{representative.projectName}</span>
                        <Badge variant="outline" className="shrink-0 font-mono text-primary">
                          {group.apps.length} ports
                        </Badge>
                      </div>
                      <span className="mt-1 block truncate font-mono text-xs text-muted-foreground">
                        {group.apps.map((app) => `:${app.port}`).join(" · ")}
                      </span>
                      {primaryApp && (
                        <span className="mt-1 block font-mono text-xs font-medium text-emerald-300">
                          Main website :{primaryApp.port}
                        </span>
                      )}
                      <span className="mt-1 block truncate text-xs font-normal text-muted-foreground">
                        {group.apps.map((app) => app.portInfo.label).join(" · ")}
                      </span>
                      <span className="mt-1 block truncate font-mono text-xs font-normal text-muted-foreground">
                        {group.projectRoot}
                      </span>
                    </div>
                    {expanded ? (
                      <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    ) : (
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    )}
                  </Button>
                </CardContent>
              </Card>
              {expanded && (
                <div className="space-y-2 border-l border-primary/20 pl-3">
                  {group.apps.map((app) => (
                    <RunningAppCard key={app.id} app={app} onStopped={onStopped} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
