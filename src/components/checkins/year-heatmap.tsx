"use client";

import { useMemo } from "react";

import { useTooltipBinding } from "@/components/checkins/chart-tooltip";
import {
  DayTooltip,
  METRICS,
  StatTooltip,
  WEEKDAY_LABELS,
  levelClass,
} from "@/components/checkins/shared";
import {
  addDays,
  diffDays,
  formatNumber,
  levelFor,
  levelThresholds,
  metricValue,
  toDateKey,
  weekdayIndex,
  type CheckinMetric,
  type DayStat,
  type MonthStat,
} from "@/lib/git/checkin-stats";
import type { CheckinRepository } from "@/lib/git/types";
import { cn } from "@/lib/utils";

const CELL = 13;
const GAP = 3;
const COLUMN = CELL + GAP;

interface YearHeatmapProps {
  byDay: ReadonlyMap<string, DayStat>;
  start: Date;
  end: Date;
  metric: CheckinMetric;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  repositories: readonly CheckinRepository[];
}

interface HeatmapCell {
  key: string;
  date: Date;
  inRange: boolean;
}

export function YearHeatmap({
  byDay,
  start,
  end,
  metric,
  selectedKey,
  onSelect,
  repositories,
}: YearHeatmapProps) {
  const bind = useTooltipBinding();
  const style = METRICS[metric];
  const todayKey = toDateKey(end);

  const { cells, weeks, monthLabels, thresholds } = useMemo(() => {
    const leading = weekdayIndex(start);
    const gridStart = addDays(start, -leading);
    const weekCount = Math.ceil((leading + diffDays(end, start) + 1) / 7);

    const gridCells: HeatmapCell[] = Array.from({ length: weekCount * 7 }, (_, index) => {
      const date = addDays(gridStart, index);
      return { key: toDateKey(date), date, inRange: date >= start && date <= end };
    });

    // Label a column when its Thursday falls in a new month (keeps labels apart).
    const labels: { column: number; text: string }[] = [];
    let previousMonth = -1;
    let lastLabelColumn = -10;
    for (let column = 0; column < weekCount; column += 1) {
      const thursday = addDays(gridStart, column * 7 + 3);
      if (thursday.getMonth() !== previousMonth) {
        previousMonth = thursday.getMonth();
        if (column - lastLabelColumn >= 3) {
          labels.push({
            column,
            text: new Intl.DateTimeFormat(undefined, { month: "short" }).format(thursday),
          });
          lastLabelColumn = column;
        }
      }
    }

    const values = gridCells
      .filter((cell) => cell.inRange)
      .map((cell) => {
        const day = byDay.get(cell.key);
        return day ? metricValue(day, metric) : 0;
      });

    return {
      cells: gridCells,
      weeks: weekCount,
      monthLabels: labels,
      thresholds: levelThresholds(values),
    };
  }, [byDay, start, end, metric]);

  return (
    <div className="overflow-x-auto pb-1">
      <div className="space-y-2" style={{ minWidth: weeks * COLUMN + 32 }}>
        <div
          className="grid"
          role="grid"
          aria-label="Daily activity calendar"
          style={{
            gridTemplateColumns: `1.75rem repeat(${weeks}, minmax(0, 1fr))`,
            gap: GAP,
          }}
        >
          {monthLabels.map((label) => (
            <span
              key={label.column}
              aria-hidden="true"
              className="text-[0.65rem] leading-none whitespace-nowrap text-muted-foreground"
              style={{ gridColumn: label.column + 2, gridRow: 1 }}
            >
              {label.text}
            </span>
          ))}
          {WEEKDAY_LABELS.map((label, index) =>
            index % 2 === 0 ? (
              <span
                key={label}
                aria-hidden="true"
                className="self-center text-[0.65rem] leading-none text-muted-foreground"
                style={{ gridColumn: 1, gridRow: index + 2 }}
              >
                {label}
              </span>
            ) : null,
          )}

          {cells.map((cell, index) => {
            if (!cell.inRange) {
              return null;
            }

            const day = byDay.get(cell.key);
            const value = day ? metricValue(day, metric) : 0;
            const level = levelFor(value, thresholds);
            const emptyDay: DayStat = {
              key: cell.key,
              commits: 0,
              added: 0,
              removed: 0,
              repos: new Map(),
            };

            return (
              <button
                key={cell.key}
                type="button"
                tabIndex={-1}
                aria-label={`${cell.key}: ${day?.commits ?? 0} commits`}
                aria-pressed={cell.key === selectedKey}
                onClick={() => onSelect(cell.key)}
                style={{ gridColumn: Math.floor(index / 7) + 2, gridRow: (index % 7) + 2 }}
                className={cn(
                  "aspect-square max-h-6 rounded-[3px] transition-transform hover:z-10 hover:scale-125 hover:ring-1 hover:ring-foreground/60",
                  levelClass(level, style.levels),
                  cell.key === todayKey && "outline-1 outline-offset-1 outline-primary/70",
                  cell.key === selectedKey && "ring-2 ring-foreground",
                )}
                {...bind(() => <DayTooltip day={day ?? emptyDay} repositories={repositories} />)}
              />
            );
          })}
        </div>

        <div className="flex items-center justify-end gap-1.5 text-[0.65rem] text-muted-foreground">
          <span>Less</span>
          {style.levels.map((classes, level) => (
            <span key={level} className={cn("size-3 rounded-[3px]", classes)} />
          ))}
          <span>More</span>
        </div>
      </div>
    </div>
  );
}

export function MonthlyBreakdown({
  months,
  metric,
}: {
  months: readonly MonthStat[];
  metric: CheckinMetric;
}) {
  const bind = useTooltipBinding();
  const style = METRICS[metric];
  const values = months.map((month) => metricValue(month, metric));
  const max = Math.max(...values, 1);

  return (
    <div className="grid gap-1.5">
      {months.map((month, index) => (
        <div
          key={month.key}
          className="grid grid-cols-[3.5rem_1fr] items-center gap-3 rounded-md px-1 py-0.5 text-xs hover:bg-muted/25 sm:grid-cols-[3.5rem_1fr_20rem]"
          {...bind(() => (
            <StatTooltip
              title={month.label}
              commits={month.commits}
              added={month.added}
              removed={month.removed}
              footer={`${month.activeDays} active days${month.partial ? " · partial month" : ""}`}
            />
          ))}
        >
          <span className="font-mono text-muted-foreground">{month.label}</span>
          <div className="h-2.5 overflow-hidden rounded-full bg-muted/40">
            <div
              className={cn("h-full rounded-full", style.levels[4], month.partial && "opacity-60")}
              style={{ width: `${(values[index] / max) * 100}%` }}
            />
          </div>
          <span className="col-span-2 flex justify-between gap-3 font-mono whitespace-nowrap text-muted-foreground sm:col-span-1">
            <span className="text-foreground">{formatNumber(month.commits)} commits</span>
            <span>
              <span className="text-emerald-300">+{formatNumber(month.added)}</span>{" "}
              <span className="text-rose-300">-{formatNumber(month.removed)}</span>
            </span>
            <span>{month.activeDays}d</span>
          </span>
        </div>
      ))}
    </div>
  );
}
