import { Clock3, Folder, GitBranch, GitCommitHorizontal } from "lucide-react";

import { ChangeSummary } from "@/components/change-summary";
import { OpenInVSCodeButton } from "@/components/open-in-vscode-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatChangedAt } from "@/lib/git/format";
import type { UncommittedProject } from "@/lib/git/types";

interface UncommittedProjectCardProps {
  project: UncommittedProject;
}

export function UncommittedProjectCard({ project }: UncommittedProjectCardProps) {
  return (
    <Card className="border-border/80 bg-card/92 py-0 shadow-black/20">
      <CardContent className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate font-medium">{project.name}</h2>
            <div className="mt-1 flex items-center gap-2">
              <GitBranch className="size-3.5 text-muted-foreground" aria-hidden="true" />
              <span className="truncate font-mono text-xs text-muted-foreground">
                {project.branch}
              </span>
            </div>
          </div>
          <Badge variant="outline" className="shrink-0 font-mono text-primary">
            <GitCommitHorizontal data-icon="inline-start" />
            {project.changes.total}
          </Badge>
        </div>

        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <Folder className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate font-mono" title={project.directory}>
            {project.directory}
          </span>
        </div>

        <ChangeSummary changes={project.changes} />

        <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-3">
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <Clock3 className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">
              Last changed {formatChangedAt(project.lastChangedAt)}
            </span>
          </div>
          <OpenInVSCodeButton
            projectId={project.id}
            projectName={project.name}
          />
        </div>
      </CardContent>
    </Card>
  );
}
