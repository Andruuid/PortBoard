import { Folder, GitBranch, Radio } from "lucide-react";

import { AppActions } from "@/components/app-actions";
import { PortRoleBadge } from "@/components/port-role-badge";
import { RuntimeBadge } from "@/components/runtime-badge";
import { SupervisionBadge } from "@/components/supervision-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { RunningApp } from "@/lib/apps/types";

interface RunningAppCardProps {
  app: RunningApp;
  onStopped: () => void;
}

export function RunningAppCard({ app, onStopped }: RunningAppCardProps) {
  return (
    <Card className="border-border/80 bg-card/92 py-0 shadow-black/20">
      <CardContent className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="font-mono text-lg font-semibold text-primary">
                :{app.port}
              </span>
              <RuntimeBadge runtime={app.runtime} />
              <PortRoleBadge portInfo={app.portInfo} />
              <SupervisionBadge supervision={app.supervision} />
            </div>
            <h2 className="truncate font-medium">{app.projectName}</h2>
          </div>
          <Radio className="mt-1 size-4 shrink-0 text-emerald-400" aria-hidden="true" />
        </div>

        <p className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs leading-5 text-muted-foreground">
          {app.portInfo.description}
          {app.supervision.kind === "supervised" && (
            <span className="mt-1 block text-amber-300/80">
              This listener may restart unless the managed stack is stopped.
            </span>
          )}
        </p>

        <div className="space-y-2 text-xs text-muted-foreground">
          <div className="flex min-w-0 items-center gap-2">
            <Folder className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate font-mono" title={app.projectRoot ?? "Unavailable"}>
              {app.projectRoot ?? "Project folder unavailable"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <GitBranch className="size-3.5" aria-hidden="true" />
            <span className="font-mono">{app.gitBranch ?? "—"}</span>
            {app.confidence === "unidentified" && (
              <Badge variant="outline" className="ml-auto text-[0.65rem] text-amber-300">
                Unidentified
              </Badge>
            )}
          </div>
        </div>

        <AppActions app={app} onStopped={onStopped} />
      </CardContent>
    </Card>
  );
}
