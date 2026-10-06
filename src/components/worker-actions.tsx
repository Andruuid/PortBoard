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
import { workerStopKey } from "@/lib/apps/pending-stops";
import { requestWorkerStop } from "@/lib/apps/stop-client";
import type { BackgroundWorker } from "@/lib/apps/types";

interface WorkerActionsProps {
  worker: BackgroundWorker;
  onStopped: () => void;
}

export function workerLabel(worker: BackgroundWorker): string {
  return worker.scriptName ?? `PID ${worker.pid}`;
}

export function WorkerActions({ worker, onStopped }: WorkerActionsProps) {
  const { isStopping, track } = useStopTasks();
  const stopping = isStopping(workerStopKey(worker.id));
  const label = workerLabel(worker);

  // Runs after the dialog has closed; must not depend on this row staying mounted.
  async function stopWorker() {
    const { ok, payload } = await requestWorkerStop(worker.id);

    if (!ok) {
      toast.error("Could not stop the worker", {
        description: payload.message ?? "Windows could not stop this worker.",
      });
      return;
    }

    toast.success(payload.message ?? `${label} stopped.`);
    onStopped();
  }

  return (
    <div className="flex items-center justify-end">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            size="sm"
            variant="destructive"
            disabled={stopping}
            aria-busy={stopping}
            aria-label={`${stopping ? "Stopping" : "Stop"} ${label} in ${worker.projectName}`}
          >
            {stopping ? (
              <LoaderCircle className="animate-spin" data-icon="inline-start" />
            ) : (
              <Square data-icon="inline-start" />
            )}
            {stopping ? "Stopping…" : "Stop"}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop {label}?</AlertDialogTitle>
            <AlertDialogDescription className="leading-6">
              Portboard will stop the verified process tree for this background
              worker in {worker.projectName}.
              <span className="mt-2 block">
                This ends {worker.processCount}{" "}
                {worker.processCount === 1 ? "process" : "processes"}
                {worker.outboundConnections > 0
                  ? ` and closes ${worker.outboundConnections} open ${
                      worker.outboundConnections === 1
                        ? "connection"
                        : "connections"
                    }`
                  : ""}
                . Any job still in flight will be lost.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep running</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void track([workerStopKey(worker.id)], stopWorker)}
            >
              <Square data-icon="inline-start" />
              Stop worker
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
