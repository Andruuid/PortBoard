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
import { planGroupStop, requestGroupStop } from "@/lib/apps/group-stop";
import type { RunningApp } from "@/lib/apps/types";

interface GroupStopActionsProps {
  apps: RunningApp[];
  projectName: string;
  onStopped: () => void;
}

export function GroupStopActions({
  apps,
  projectName,
  onStopped,
}: GroupStopActionsProps) {
  const [open, setOpen] = useState(false);
  const [stopping, setStopping] = useState(false);
  const plan = planGroupStop(apps, projectName);

  async function stopAll() {
    if (plan.targets.length === 0) {
      return;
    }

    setStopping(true);

    try {
      const result = await requestGroupStop(plan.targets);
      const freed =
        result.releasedPorts.length > 0
          ? `Freed ${result.releasedPorts.map((port) => `:${port}`).join(", ")}`
          : undefined;

      if (result.failureMessages.length > 0) {
        toast.error(
          result.stoppedCount > 0
            ? `Stopped ${result.stoppedCount} of ${plan.targets.length} process trees`
            : "Could not stop every listener",
          { description: result.failureMessages.join(" ") },
        );
      }

      if (result.stoppedCount === 0) {
        return;
      }

      if (result.failureMessages.length === 0) {
        toast.success(
          result.successMessages.length === 1
            ? result.successMessages[0]
            : `Stopped ${result.stoppedCount} process trees for ${projectName}.`,
          { description: freed },
        );
      }

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

  return (
    <div className="flex items-center justify-end gap-2">
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            aria-label={`Stop all ${apps.length} ${projectName} listeners`}
          >
            <Square data-icon="inline-start" />
            Stop all
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{plan.title}</AlertDialogTitle>
            <AlertDialogDescription className="leading-6">
              {plan.detail}
              {plan.managedCommands.length > 0 && (
                <span className="mt-2 block">
                  Managed commands: {plan.managedCommands.join(", ")}.
                </span>
              )}
              <span className="mt-2 block">
                This will free{" "}
                {plan.ports.length === 1
                  ? `port ${plan.ports[0]}`
                  : `ports ${plan.ports.join(", ")}`}
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
              {stopping ? "Stopping…" : "Stop all"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
