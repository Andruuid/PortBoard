import type { ReactNode } from "react";

import type { CheckinMetric, DayStat, HeatLevel } from "@/lib/git/checkin-stats";
import {
  formatCompact,
  formatNumber,
  formatSigned,
  fromDateKey,
} from "@/lib/git/checkin-stats";
import type { CheckinRepository } from "@/lib/git/types";
import { cn } from "@/lib/utils";

type LevelClasses = readonly [string, string, string, string, string];

interface MetricStyle {
  label: string;
  /** Solid heat-map cells, level 0 (empty) to 4. */
  levels: LevelClasses;
  /** Softer fills for large calendar cells that carry text. */
  soft: LevelClasses;
  fill: string;
  text: string;
}

export const METRICS: Record<CheckinMetric, MetricStyle> = {
  commits: {
    label: "Commits",
    levels: ["bg-muted/45", "bg-primary/25", "bg-primary/45", "bg-primary/70", "bg-primary"],
    soft: ["bg-muted/20", "bg-primary/8", "bg-primary/16", "bg-primary/26", "bg-primary/40"],
    fill: "fill-primary",
    text: "text-primary",
  },
  added: {
    label: "Lines added",
    levels: ["bg-muted/45", "bg-emerald-400/25", "bg-emerald-400/45", "bg-emerald-400/70", "bg-emerald-400"],
    soft: ["bg-muted/20", "bg-emerald-400/8", "bg-emerald-400/16", "bg-emerald-400/26", "bg-emerald-400/40"],
    fill: "fill-emerald-400",
    text: "text-emerald-300",
  },
  removed: {
    label: "Lines removed",
    levels: ["bg-muted/45", "bg-rose-400/25", "bg-rose-400/45", "bg-rose-400/70", "bg-rose-400"],
    soft: ["bg-muted/20", "bg-rose-400/8", "bg-rose-400/16", "bg-rose-400/26", "bg-rose-400/40"],
    fill: "fill-rose-400",
    text: "text-rose-300",
  },
  churn: {
    label: "Lines changed",
    levels: ["bg-muted/45", "bg-amber-300/25", "bg-amber-300/45", "bg-amber-300/70", "bg-amber-300"],
    soft: ["bg-muted/20", "bg-amber-300/8", "bg-amber-300/16", "bg-amber-300/26", "bg-amber-300/40"],
    fill: "fill-amber-300",
    text: "text-amber-200",
  },
};

export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export function levelClass(level: HeatLevel, classes: LevelClasses): string {
  return classes[level];
}

export function formatDayLong(key: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(fromDateKey(key));
}

export function formatDayShort(key: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(fromDateKey(key));
}

export function formatTime(epochSeconds: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(epochSeconds * 1000));
}

export function formatRelative(epochSeconds: number, now: Date): string {
  const days = Math.floor((now.getTime() / 1000 - epochSeconds) / 86_400);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 31) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}

/** Stable, well-spread colour per repository index. */
export function repoColor(index: number): string {
  return `hsl(${Math.round((index * 137.508) % 360)} 62% 64%)`;
}

export function RepoDot({ index, className }: { index: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block size-2 shrink-0 rounded-full", className)}
      style={{ backgroundColor: repoColor(index) }}
    />
  );
}

export function LineDelta({
  added,
  removed,
  compact = false,
  className,
}: {
  added: number;
  removed: number;
  compact?: boolean;
  className?: string;
}) {
  const format = compact ? formatCompact : formatNumber;
  return (
    <span className={cn("font-mono", className)}>
      <span className="text-emerald-300">+{format(added)}</span>{" "}
      <span className="text-rose-300">-{format(removed)}</span>
    </span>
  );
}

function TooltipRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{children}</span>
    </div>
  );
}

export function StatTooltip({
  title,
  commits,
  added,
  removed,
  repos,
  repositories,
  footer,
}: {
  title: string;
  commits: number;
  added: number;
  removed: number;
  repos?: ReadonlyMap<number, number>;
  repositories?: readonly CheckinRepository[];
  footer?: string;
}) {
  const topRepos =
    repos && repositories
      ? [...repos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
      : [];

  return (
    <div className="space-y-1.5">
      <div className="font-medium">{title}</div>
      {commits === 0 ? (
        <div className="text-muted-foreground">No commits</div>
      ) : (
        <>
          <TooltipRow label="Commits">{formatNumber(commits)}</TooltipRow>
          <TooltipRow label="Added">
            <span className="text-emerald-300">+{formatNumber(added)}</span>
          </TooltipRow>
          <TooltipRow label="Removed">
            <span className="text-rose-300">-{formatNumber(removed)}</span>
          </TooltipRow>
          <TooltipRow label="Net">{formatSigned(added - removed)}</TooltipRow>
          {topRepos.length > 0 && repositories && (
            <div className="border-t border-border/70 pt-1.5">
              {topRepos.map(([repo, count]) => (
                <div key={repo} className="flex items-center justify-between gap-6">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <RepoDot index={repo} />
                    <span className="truncate">{repositories[repo]?.name}</span>
                  </span>
                  <span className="font-mono text-muted-foreground">{count}</span>
                </div>
              ))}
              {repos && repos.size > topRepos.length && (
                <div className="text-muted-foreground">
                  +{repos.size - topRepos.length} more
                </div>
              )}
            </div>
          )}
        </>
      )}
      {footer && <div className="pt-0.5 text-[0.65rem] text-muted-foreground">{footer}</div>}
    </div>
  );
}

export function DayTooltip({
  day,
  repositories,
}: {
  day: DayStat;
  repositories: readonly CheckinRepository[];
}) {
  return (
    <StatTooltip
      title={formatDayLong(day.key)}
      commits={day.commits}
      added={day.added}
      removed={day.removed}
      repos={day.repos}
      repositories={repositories}
      footer={day.commits > 0 ? "Click for the commit list" : undefined}
    />
  );
}

export function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  options: readonly { value: T; label: string; icon?: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "inline-flex h-9 items-center gap-0.5 rounded-lg border border-border/70 bg-card/65 p-0.5",
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
            option.value === value && "bg-primary/15 text-foreground shadow-sm",
          )}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}
