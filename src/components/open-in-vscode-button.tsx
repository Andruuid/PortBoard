"use client";

import { LoaderCircle, SquareCode } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { OpenProjectResponse } from "@/lib/git/types";

interface OpenInVSCodeButtonProps {
  projectId: string;
  projectName: string;
}

export function OpenInVSCodeButton({
  projectId,
  projectName,
}: OpenInVSCodeButtonProps) {
  const [opening, setOpening] = useState(false);

  async function openProject() {
    setOpening(true);

    try {
      const response = await fetch("/api/uncommitted/open", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: projectId }),
      });
      const payload = (await response.json()) as Partial<OpenProjectResponse> & {
        message?: string;
      };

      if (!response.ok || !payload.opened) {
        throw new Error(payload.message || "Visual Studio Code could not be opened.");
      }

      toast.success(payload.message || `Opened ${projectName} in Visual Studio Code.`);
    } catch (error) {
      toast.error("Could not open Visual Studio Code", {
        description:
          error instanceof Error ? error.message : "An unexpected error occurred.",
      });
    } finally {
      setOpening(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={opening}
      onClick={openProject}
      aria-label={`Open ${projectName} folder in Visual Studio Code`}
    >
      {opening ? (
        <LoaderCircle className="animate-spin" data-icon="inline-start" />
      ) : (
        <SquareCode data-icon="inline-start" />
      )}
      {opening ? "Opening" : "Open"}
    </Button>
  );
}
