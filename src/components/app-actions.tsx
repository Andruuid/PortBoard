"use client";

import { useState } from "react";
import { ExternalLink, LoaderCircle, Square } from "lucide-react";
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
import type { CloseAppResponse, RunningApp } from "@/lib/apps/types";

interface AppActionsProps {
  app: RunningApp;
  onStopped: () => void;
}

export function AppActions({ app, onStopped }: AppActionsProps) {
  const [open, setOpen] = useState(false);
  const [stopping, setStopping] = useState(false);

  async function stopApp() {
    setStopping(true);

    try {
      const response = await fetch("/api/apps/close", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: app.id }),
      });
      const payload = (await response.json()) as Partial<CloseAppResponse> & {
        message?: string;
      };

      if (!response.ok || !payload.stopped) {
        throw new Error(payload.message ?? "Windows could not stop this app.");
      }

      toast.success(payload.message ?? `${app.projectName} stopped.`, {
        description:
          payload.releasedPorts && payload.releasedPorts.length > 0
            ? `Freed ${payload.releasedPorts.map((port) => `:${port}`).join(", ")}`
            : undefined,
      });
      setOpen(false);
      onStopped();
    } catch (error) {
      toast.error("Could not close the app", {
        description:
          error instanceof Error ? error.message : "The stop request failed.",
      });
    } finally {
      setStopping(false);
    }
  }

  return (
    <div className="flex items-center justify-end gap-2">
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

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          <Button
            size="sm"
            variant="destructive"
            aria-label={`Close ${app.projectName} on port ${app.port}`}
          >
            <Square data-icon="inline-start" />
            Close
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop {app.projectName}?</AlertDialogTitle>
            <AlertDialogDescription className="leading-6">
              Portboard will stop the verified process tree and free {" "}
              {app.allPorts.length === 1
                ? `port ${app.allPorts[0]}`
                : `ports ${app.allPorts.join(", ")}`}
              . Unsaved in-memory work in that server will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={stopping}>Keep running</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={stopping}
              onClick={(event) => {
                event.preventDefault();
                void stopApp();
              }}
            >
              {stopping ? (
                <LoaderCircle className="animate-spin" data-icon="inline-start" />
              ) : (
                <Square data-icon="inline-start" />
              )}
              {stopping ? "Stopping…" : "Stop app"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
