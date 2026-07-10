import {
  CircleCheckBig,
  Clock3,
  Folder,
  GitBranch,
  GitCommitHorizontal,
} from "lucide-react";

import { ChangeSummary } from "@/components/change-summary";
import { OpenInVSCodeButton } from "@/components/open-in-vscode-button";
import { UncommittedProjectCard } from "@/components/uncommitted-project-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatChangedAt } from "@/lib/git/format";
import type { UncommittedProject } from "@/lib/git/types";

interface UncommittedProjectsViewProps {
  projects: UncommittedProject[] | null;
}

function UncommittedSkeleton() {
  return (
    <Card className="border-border/80 bg-card/90 py-0">
      <CardContent className="space-y-4 p-5">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="flex items-center gap-4 py-2">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="hidden h-5 flex-1 md:block" />
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-6 w-40" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function AllProjectsClean() {
  return (
    <Card className="border-dashed border-border/80 bg-card/65">
      <CardContent className="flex min-h-72 flex-col items-center justify-center px-6 text-center">
        <div className="mb-5 rounded-2xl border border-emerald-400/15 bg-emerald-400/8 p-4">
          <CircleCheckBig className="size-7 text-emerald-300" aria-hidden="true" />
        </div>
        <h2 className="text-lg font-medium">Every discovered project is clean</h2>
        <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
          There are no staged, modified, conflicted, or untracked files under the
          configured project roots.
        </p>
      </CardContent>
    </Card>
  );
}

export function UncommittedProjectsView({
  projects,
}: UncommittedProjectsViewProps) {
  if (projects === null) {
    return <UncommittedSkeleton />;
  }

  if (projects.length === 0) {
    return <AllProjectsClean />;
  }

  return (
    <>
      <Card className="hidden overflow-hidden border-border/80 bg-card/88 py-0 shadow-2xl shadow-black/20 md:block">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-border/70 bg-muted/25 hover:bg-muted/25">
                <TableHead className="w-72 pl-5">Project</TableHead>
                <TableHead>Directory</TableHead>
                <TableHead className="w-56">Branch</TableHead>
                <TableHead className="w-72">Changes</TableHead>
                <TableHead className="w-52 pr-5">Last changed</TableHead>
                <TableHead className="w-24 pr-5 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((project) => (
                <TableRow key={project.id} className="border-border/60">
                  <TableCell className="pl-5">
                    <div className="flex max-w-64 items-center gap-2">
                      <span className="truncate font-medium" title={project.name}>
                        {project.name}
                      </span>
                      <Badge
                        variant="outline"
                        className="shrink-0 font-mono text-[0.65rem] text-primary"
                      >
                        <GitCommitHorizontal data-icon="inline-start" />
                        {project.changes.total}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex max-w-[34rem] items-center gap-2 text-xs text-muted-foreground">
                      <Folder className="size-3.5 shrink-0" aria-hidden="true" />
                      <span className="truncate font-mono" title={project.directory}>
                        {project.directory}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <GitBranch className="size-3.5 shrink-0" aria-hidden="true" />
                      <span className="max-w-48 truncate font-mono" title={project.branch}>
                        {project.branch}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <ChangeSummary changes={project.changes} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock3 className="size-3.5 shrink-0" aria-hidden="true" />
                      <span title={project.lastChangedAt}>
                        {formatChangedAt(project.lastChangedAt)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="pr-5 text-right">
                    <OpenInVSCodeButton
                      projectId={project.id}
                      projectName={project.name}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:hidden">
        {projects.map((project) => (
          <UncommittedProjectCard key={project.id} project={project} />
        ))}
      </div>
    </>
  );
}
