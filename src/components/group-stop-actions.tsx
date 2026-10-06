"use client";

import { LoaderCircle, Square } from "lucide-react";
import { toast } from "sonner";

import { useStopTasks } from "@/components/stop-tasks-provider";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  collectGroupPorts,
  selectGroupStopTargets,
} from "@/lib/apps/group-stop";
import { appStopKey } from "@/lib/apps/pending-stops";
import {
  formatFreedPorts,
  requestAppStop,
  summarizeStopResults,
} from "@/lib/apps/stop-client";
import type { RunningApp } from "@/lib/apps/types";

interface GroupStopActionsProps {
  apps: RunningApp[];
  onStopped: () => void;
}

export function GroupStopActions({ apps, onStopped }: GroupStopActionsProps) {
  const { isStopping, track } = useStopTasks();
  const stopping = apps.some((app) => isStopping(appStopKey(app.id)));

  const targets = selectGroupStopTargets(apps);
  const ports = collectGroupPorts(apps);
  const representative = targets[0] ?? apps[0];
  const isSupervisedStack = targets.some(
    (app) => app.supervision.kind === "supervised",
  );
  const projectName = representative?.projectName ?? "this project";
  const supervised = targets.find((app) => app.supervision.kind === "supervised");

  // Runs after the dialog has closed; must not depend on this row staying mounted.
  async function stopAll() {
    const summary = summarizeStopResults(
      await Promise.all(targets.map((app) => requestAppStop(app.id))),
    );

    if (summary.succeeded > 0) {
      toast.success(
        summary.failed === 0
          ? (summary.firstSuccessMessage ??
              (isSupervisedStack
                ? `${projectName}'s managed development stack stopped successfully.`
                : `${projectName} stopped successfully.`))
          : `Stopped ${summary.succeeded} of ${targets.length} process trees for ${projectName}.`,
        { description: formatFreedPorts(summary.releasedPorts) },
      );
      onStopped();
    }

    if (summary.failed > 0) {
      toast.error("Could not stop the stack", {
        description:
          summary.firstFailureMessage ?? "Windows could not stop this stack.",
      });
    }
  }

  if (!representative) {
    return null;
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            size="sm"
            variant="destructive"
            disabled={stopping}
            aria-busy={stopping}
            aria-label={`${stopping ? "Stopping" : "Stop"} all listeners for ${projectName}`}
          >
            {stopping ? (
              <LoaderCircle className="animate-spin" data-icon="inline-start" />
            ) : (
              <Square data-icon="inline-start" />
            )}
            {stopping ? "Stopping…" : "Stop all"}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isSupervisedStack
                ? `Stop ${projectName}'s managed stack?`
                : `Stop all listeners for ${projectName}?`}
            </AlertDialogTitle>
            <AlertDialogDescription className="leading-6">
              {isSupervisedStack && supervised
                ? `Portboard will stop the verified ${supervised.supervision.supervisorName} supervisor and every sibling command it manages.`
                : `Portboard will stop ${targets.length} verified process ${
                    targets.length === 1 ? "tree" : "trees"
                  } in parallel.`}
              {isSupervisedStack &&
                supervised &&
                supervised.supervision.managedCommands.length > 0 && (
                  <span className="mt-2 block">
                    Managed commands:{" "}
                    {supervised.supervision.managedCommands.join(", ")}.
                  </span>
                )}
              <span className="mt-2 block">
                This will free{" "}
                {ports.length === 1
                  ? `port ${ports[0]}`
                  : `ports ${ports.join(", ")}`}
                . Unsaved in-memory work in the affected processes will be lost.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep running</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={targets.length === 0}
              onClick={() =>
                // Mark every app in the group: a supervised stop takes the siblings down too.
                void track(
                  apps.map((app) => appStopKey(app.id)),
                  stopAll,
                )
              }
            >
              <Square data-icon="inline-start" />
              {isSupervisedStack ? "Stop managed stack" : "Stop all"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
