"use client";

import { CircleSlash2, ExternalLink, LoaderCircle, Square } from "lucide-react";
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
import { appStopKey } from "@/lib/apps/pending-stops";
import { formatFreedPorts, requestAppStop } from "@/lib/apps/stop-client";
import type { RunningApp } from "@/lib/apps/types";

interface AppActionsProps {
  app: RunningApp;
  onStopped: () => void;
}

export function AppActions({ app, onStopped }: AppActionsProps) {
  const { isStopping, track } = useStopTasks();
  const stopping = isStopping(appStopKey(app.id));
  const isSupervised = app.supervision.kind === "supervised";
  const destructiveLabel = isSupervised ? "Stop stack" : "Close";

  // Runs after the dialog has closed; must not depend on this row staying mounted.
  async function stopApp() {
    const { ok, payload } = await requestAppStop(app.id);

    if (!ok) {
      toast.error(isSupervised ? "Could not stop the stack" : "Could not close the app", {
        description: payload.message ?? "Windows could not stop this app.",
      });
      return;
    }

    toast.success(payload.message ?? `${app.projectName} stopped.`, {
      description: formatFreedPorts(payload.releasedPorts ?? []),
    });
    onStopped();
  }

  return (
    <div className="flex items-center justify-end gap-2">
      {app.portInfo.canOpen ? (
        <Button asChild size="sm" variant="outline">
          <a
            href={app.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${app.projectName} on port ${app.port}`}
          >
            <ExternalLink data-icon="inline-start" />
            Open
          </a>
        </Button>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled
          aria-label={`${app.portInfo.label} on port ${app.port} has no browser page`}
        >
          <CircleSlash2 data-icon="inline-start" />
          No web UI
        </Button>
      )}

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            size="sm"
            variant="destructive"
            disabled={stopping}
            aria-busy={stopping}
            aria-label={`${stopping ? "Stopping" : destructiveLabel} ${app.projectName} on port ${app.port}`}
          >
            {stopping ? (
              <LoaderCircle className="animate-spin" data-icon="inline-start" />
            ) : (
              <Square data-icon="inline-start" />
            )}
            {stopping ? "Stopping…" : destructiveLabel}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isSupervised
                ? `Stop ${app.projectName}'s managed stack?`
                : `Stop ${app.projectName}?`}
            </AlertDialogTitle>
            <AlertDialogDescription className="leading-6">
              {isSupervised
                ? `Portboard will stop the verified ${app.supervision.supervisorName} supervisor and every sibling command it manages.`
                : "Portboard will stop the verified process tree."}
              {isSupervised && app.supervision.managedCommands.length > 0 && (
                <span className="mt-2 block">
                  Managed commands: {app.supervision.managedCommands.join(", ")}.
                </span>
              )}
              <span className="mt-2 block">
                This will free {" "}
                {app.allPorts.length === 1
                  ? `port ${app.allPorts[0]}`
                  : `ports ${app.allPorts.join(", ")}`}
                . Unsaved in-memory work in the affected processes will be lost.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep running</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void track([appStopKey(app.id)], stopApp)}
            >
              <Square data-icon="inline-start" />
              {isSupervised ? "Stop managed stack" : "Stop app"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
