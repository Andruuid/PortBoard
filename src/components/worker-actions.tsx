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
import type { BackgroundWorker, StopWorkerResponse } from "@/lib/apps/types";

interface WorkerActionsProps {
  worker: BackgroundWorker;
  onStopped: () => void;
}

export function workerLabel(worker: BackgroundWorker): string {
  return worker.scriptName ?? `PID ${worker.pid}`;
}

export function WorkerActions({ worker, onStopped }: WorkerActionsProps) {
  const [open, setOpen] = useState(false);
  const [stopping, setStopping] = useState(false);
  const label = workerLabel(worker);

  async function stopWorker() {
    setStopping(true);

    try {
      const response = await fetch("/api/workers/stop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: worker.id }),
      });
      const payload = (await response.json()) as Partial<StopWorkerResponse> & {
        message?: string;
      };

      if (!response.ok || !payload.stopped) {
        throw new Error(payload.message ?? "Windows could not stop this worker.");
      }

      toast.success(payload.message ?? `${label} stopped.`);
      setOpen(false);
      onStopped();
    } catch (error) {
      toast.error("Could not stop the worker", {
        description:
          error instanceof Error ? error.message : "The stop request failed.",
      });
    } finally {
      setStopping(false);
    }
  }

  return (
    <div className="flex items-center justify-end">
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          <Button
            size="sm"
            variant="destructive"
            aria-label={`Stop ${label} in ${worker.projectName}`}
          >
            <Square data-icon="inline-start" />
            Stop
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
            <AlertDialogCancel disabled={stopping}>Keep running</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={stopping}
              onClick={(event) => {
                event.preventDefault();
                void stopWorker();
              }}
            >
              {stopping ? (
                <LoaderCircle className="animate-spin" data-icon="inline-start" />
              ) : (
                <Square data-icon="inline-start" />
              )}
              {stopping ? "Stopping…" : "Stop worker"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
