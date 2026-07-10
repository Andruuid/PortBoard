import { Badge } from "@/components/ui/badge";
import type { ChangeCounts } from "@/lib/git/types";

interface ChangeSummaryProps {
  changes: ChangeCounts;
}

export function ChangeSummary({ changes }: ChangeSummaryProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {changes.conflicted > 0 && (
        <Badge variant="destructive" className="font-mono text-[0.65rem]">
          {changes.conflicted} conflicted
        </Badge>
      )}
      {changes.staged > 0 && (
        <Badge
          variant="outline"
          className="border-sky-400/20 bg-sky-400/8 font-mono text-[0.65rem] text-sky-300"
        >
          {changes.staged} staged
        </Badge>
      )}
      {changes.modified > 0 && (
        <Badge
          variant="outline"
          className="border-amber-300/20 bg-amber-300/8 font-mono text-[0.65rem] text-amber-200"
        >
          {changes.modified} modified
        </Badge>
      )}
      {changes.untracked > 0 && (
        <Badge
          variant="outline"
          className="border-emerald-400/20 bg-emerald-400/8 font-mono text-[0.65rem] text-emerald-300"
        >
          {changes.untracked} untracked
        </Badge>
      )}
    </div>
  );
}
