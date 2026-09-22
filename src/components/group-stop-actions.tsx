"use client";

import { useState } from "react";
import { LoaderCircle, Square } from "lucide-react";
import { toast } from "sonner";

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
import type { CloseAppResponse, RunningApp } from "@/lib/apps/types";

interface GroupStopActionsProps {
  apps: RunningApp[];
  onStopped: () => void;
}

export function GroupStopActions({ apps, onStopped }: GroupStopActionsProps) {
  const [open, setOpen] = useState(false);
  const [stopping, setStopping] = useState(false);

  const targets = selectGroupStopTargets(apps);
  const ports = collectGroupPorts(apps);
  const representative = targets[0] ?? apps[0];
  const isSupervisedStack = targets.some(
    (app) => app.supervision.kind === "supervised",
  );
  const projectName = representative?.projectName ?? "this project";
  const supervised = targets.find((app) => app.supervision.kind === "supervised");

  async function stopAll() {
    if (targets.length === 0) {
      return;
    }

    setStopping(true);

    try {
      const results = await Promise.all(
        targets.map(async (app) => {
          const response = await fetch("/api/apps/close", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ id: app.id }),
          });
          const payload = (await response.json()) as Partial<CloseAppResponse> & {
            message?: string;
          };

          return { response, payload, app };
        }),
      );

      const failures = results.filter(
        ({ response, payload }) => !response.ok || !payload.stopped,
      );

      if (failures.length > 0) {
        const first = failures[0];
        throw new Error(
          first.payload.message ?? "Windows could not stop this stack.",
        );
      }

      const releasedPorts = [
        ...new Set(
          results.flatMap(({ payload }) => payload.releasedPorts ?? []),
        ),
      ].sort((a, b) => a - b);

      const successMessage =
        results.find(({ payload }) => payload.message)?.payload.message ??
        (isSupervisedStack
          ? `${projectName}'s managed development stack stopped successfully.`
          : `${projectName} stopped successfully.`);

      toast.success(successMessage, {
        description:
          releasedPorts.length > 0
            ? `Freed ${releasedPorts.map((port) => `:${port}`).join(", ")}`
            : undefined,
      });
      setOpen(false);
      onStopped();
    } catch (error) {
      toast.error("Could not stop the stack", {
        description:
          error instanceof Error ? error.message : "The stop request failed.",
      });
    } finally {
      setStopping(false);
    }
  }

  if (!representative) {
    return null;
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          <Button
            size="sm"
            variant="destructive"
            aria-label={`Stop all listeners for ${projectName}`}
          >
            <Square data-icon="inline-start" />
            Stop all
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
            <AlertDialogCancel disabled={stopping}>Keep running</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={stopping}
              onClick={(event) => {
                event.preventDefault();
                void stopAll();
              }}
            >
              {stopping ? (
                <LoaderCircle className="animate-spin" data-icon="inline-start" />
              ) : (
                <Square data-icon="inline-start" />
              )}
              {stopping
                ? "Stopping…"
                : isSupervisedStack
                  ? "Stop managed stack"
                  : "Stop all"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
