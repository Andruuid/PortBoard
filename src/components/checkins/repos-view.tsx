"use client";

import { useMemo } from "react";

import { useTooltipBinding } from "@/components/checkins/chart-tooltip";
import {
  LineDelta,
  METRICS,
  RepoDot,
  StatTooltip,
  formatRelative,
} from "@/components/checkins/shared";
import {
  formatNumber,
  metricValue,
  repoStats,
  type CheckinMetric,
  type RepoStat,
} from "@/lib/git/checkin-stats";
import type { CheckinCommit, CheckinRepository } from "@/lib/git/types";
import { cn } from "@/lib/utils";

interface ReposViewProps {
  commits: readonly CheckinCommit[];
  repositories: readonly CheckinRepository[];
  start: Date;
  end: Date;
  metric: CheckinMetric;
  /** Repositories currently isolated by the filter, if any. */
  isolated: ReadonlySet<number> | null;
  onIsolate: (repo: number) => void;
}

function Sparkline({ values, className }: { values: readonly number[]; className?: string }) {
  const max = Math.max(...values, 1);
  const width = 120;
  const height = 24;
  const step = width / Math.max(values.length, 1);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={cn("h-6 w-30", className)} aria-hidden="true">
      {values.map((value, index) =>
        value > 0 ? (
          <rect
            key={index}
            x={index * step}
            width={Math.max(step - 0.5, 0.8)}
            y={height - (value / max) * height}
            height={(value / max) * height}
            className="fill-primary/80"
          />
        ) : null,
      )}
    </svg>
  );
}

export function ReposView({
  commits,
  repositories,
  start,
  end,
  metric,
  isolated,
  onIsolate,
}: ReposViewProps) {
  const bind = useTooltipBinding();
  const style = METRICS[metric];

  const { rows, max } = useMemo(() => {
    const sorted: RepoStat[] = repoStats(commits, start, end).sort(
      (left, right) =>
        metricValue(right, metric) - metricValue(left, metric) || right.commits - left.commits,
    );
    return { rows: sorted, max: Math.max(...sorted.map((row) => metricValue(row, metric)), 1) };
  }, [commits, start, end, metric]);

  if (rows.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No repository has commits for this selection.
      </p>
    );
  }

  return (
    <div>
      <p className="mb-3 text-xs text-muted-foreground">
        Ranked by {style.label.toLowerCase()}. Click a repository to filter everything to it, click again to
        clear.
      </p>
      <div className="grid gap-1">
        {rows.map((row) => {
          const repository = repositories[row.repo];
          const active = isolated?.size === 1 && isolated.has(row.repo);

          return (
            <button
              key={row.repo}
              type="button"
              aria-pressed={active}
              onClick={() => onIsolate(row.repo)}
              className={cn(
                "grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 rounded-lg border border-transparent px-3 py-2 text-left text-xs transition-colors hover:bg-muted/30 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_9rem_10rem_8rem]",
                active && "border-primary/50 bg-primary/8",
              )}
              {...bind(() => (
                <StatTooltip
                  title={repository?.name ?? "Unknown"}
                  commits={row.commits}
                  added={row.added}
                  removed={row.removed}
                  footer={`${row.activeDays} active days · ${repository?.directory ?? ""}`}
                />
              ))}
            >
              <span className="flex min-w-0 items-center gap-2">
                <RepoDot index={row.repo} />
                <span className="truncate text-sm font-medium">{repository?.name}</span>
              </span>
              <span className="hidden h-2.5 overflow-hidden rounded-full bg-muted/40 md:block">
                <span
                  className={cn("block h-full rounded-full", style.levels[4])}
                  style={{ width: `${(metricValue(row, metric) / max) * 100}%` }}
                />
              </span>
              <span className="text-right font-mono md:text-left">
                <span className="text-foreground">{formatNumber(row.commits)}</span>
                <span className="text-muted-foreground"> commits</span>
              </span>
              <LineDelta
                added={row.added}
                removed={row.removed}
                className="col-span-2 md:col-span-1"
              />
              <span className="hidden items-center justify-end gap-3 md:flex">
                <Sparkline values={row.daily} />
              </span>
              <span className="col-span-2 text-[0.7rem] text-muted-foreground md:hidden">
                {row.activeDays} active days · last {formatRelative(row.lastAt, end)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
