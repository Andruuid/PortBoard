"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { useTooltipBinding } from "@/components/checkins/chart-tooltip";
import {
  DayTooltip,
  METRICS,
  StatTooltip,
  WEEKDAY_LABELS,
  levelClass,
} from "@/components/checkins/shared";
import { Button } from "@/components/ui/button";
import {
  addDays,
  endOfMonth,
  formatCompact,
  formatNumber,
  levelFor,
  levelThresholds,
  metricValue,
  startOfMonth,
  startOfWeek,
  toDateKey,
  type CheckinMetric,
  type DayStat,
} from "@/lib/git/checkin-stats";
import type { CheckinRepository } from "@/lib/git/types";
import { cn } from "@/lib/utils";

interface MonthCalendarProps {
  byDay: ReadonlyMap<string, DayStat>;
  month: Date;
  windowStart: Date;
  today: Date;
  metric: CheckinMetric;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onMonthChange: (month: Date) => void;
  repositories: readonly CheckinRepository[];
}

interface WeekRow {
  days: (Date | null)[];
  commits: number;
  added: number;
  removed: number;
  activeDays: number;
}

export function MonthCalendar({
  byDay,
  month,
  windowStart,
  today,
  metric,
  selectedKey,
  onSelect,
  onMonthChange,
  repositories,
}: MonthCalendarProps) {
  const bind = useTooltipBinding();
  const style = METRICS[metric];
  const todayKey = toDateKey(today);
  const first = startOfMonth(month);
  const last = endOfMonth(month);
  const canGoBack = first > startOfMonth(windowStart);
  const canGoForward = first < startOfMonth(today);

  const { weeks, thresholds } = (() => {
    const rows: WeekRow[] = [];
    const monthValues: number[] = [];

    for (
      let weekStart = startOfWeek(first);
      weekStart <= last && weekStart <= today;
      weekStart = addDays(weekStart, 7)
    ) {
      const row: WeekRow = { days: [], commits: 0, added: 0, removed: 0, activeDays: 0 };
      for (let offset = 0; offset < 7; offset += 1) {
        const date = addDays(weekStart, offset);
        if (date < first || date > last) {
          row.days.push(null);
          continue;
        }
        row.days.push(date);
        const day = byDay.get(toDateKey(date));
        if (day) {
          row.commits += day.commits;
          row.added += day.added;
          row.removed += day.removed;
          row.activeDays += 1;
          monthValues.push(metricValue(day, metric));
        }
      }
      rows.push(row);
    }

    // Shades are relative to this month so quiet months still show a pattern.
    return { weeks: rows, thresholds: levelThresholds(monthValues) };
  })();

  const title = new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
  }).format(first);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-base font-medium">{title}</h3>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            disabled={toDateKey(startOfMonth(today)) === toDateKey(first)}
            onClick={() => onMonthChange(startOfMonth(today))}
          >
            Today
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Previous month"
            disabled={!canGoBack}
            onClick={() => onMonthChange(new Date(first.getFullYear(), first.getMonth() - 1, 1))}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Next month"
            disabled={!canGoForward}
            onClick={() => onMonthChange(new Date(first.getFullYear(), first.getMonth() + 1, 1))}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1.5 sm:grid-cols-[repeat(7,minmax(0,1fr))_minmax(0,0.9fr)]">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="px-1 pb-1 text-[0.7rem] font-medium text-muted-foreground">
            {label}
          </div>
        ))}
        <div className="hidden px-1 pb-1 text-[0.7rem] font-medium text-muted-foreground sm:block">
          Week
        </div>

        {weeks.map((week, weekIndex) => (
          <WeekCells
            key={weekIndex}
            week={week}
            byDay={byDay}
            todayKey={todayKey}
            selectedKey={selectedKey}
            windowStart={windowStart}
            today={today}
            metric={metric}
            thresholds={thresholds}
            onSelect={onSelect}
            repositories={repositories}
            levels={style.soft}
            bind={bind}
          />
        ))}
      </div>
    </div>
  );
}

function WeekCells({
  week,
  byDay,
  todayKey,
  selectedKey,
  windowStart,
  today,
  metric,
  thresholds,
  onSelect,
  repositories,
  levels,
  bind,
}: {
  week: WeekRow;
  byDay: ReadonlyMap<string, DayStat>;
  todayKey: string;
  selectedKey: string | null;
  windowStart: Date;
  today: Date;
  metric: CheckinMetric;
  thresholds: readonly [number, number, number];
  onSelect: (key: string) => void;
  repositories: readonly CheckinRepository[];
  levels: readonly [string, string, string, string, string];
  bind: ReturnType<typeof useTooltipBinding>;
}) {
  return (
    <>
      {week.days.map((date, index) => {
        if (!date) {
          return <div key={`blank-${index}`} className="hidden min-h-20 sm:block" />;
        }

        const key = toDateKey(date);
        const outside = date > today || date < windowStart;
        const day = byDay.get(key);
        const level = levelFor(day ? metricValue(day, metric) : 0, thresholds);
        const emptyDay: DayStat = { key, commits: 0, added: 0, removed: 0, repos: new Map() };

        return (
          <button
            key={key}
            type="button"
            disabled={outside}
            aria-pressed={key === selectedKey}
            aria-label={`${key}: ${day?.commits ?? 0} commits`}
            onClick={() => onSelect(key)}
            className={cn(
              "flex min-h-20 flex-col justify-between rounded-lg border border-border/60 p-1.5 text-left transition-colors hover:border-foreground/40 focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default disabled:opacity-35 disabled:hover:border-border/60 sm:p-2",
              levelClass(level, levels),
              key === todayKey && "border-primary/70",
              key === selectedKey && "border-foreground ring-1 ring-foreground",
            )}
            {...(outside ? {} : bind(() => <DayTooltip day={day ?? emptyDay} repositories={repositories} />))}
          >
            <span
              className={cn(
                "text-[0.7rem]",
                key === todayKey ? "font-semibold text-primary" : "text-muted-foreground",
              )}
            >
              {date.getDate()}
            </span>
            {day && day.commits > 0 ? (
              <span className="flex flex-col">
                <span className="font-mono text-lg leading-none font-semibold sm:text-xl">
                  {day.commits}
                </span>
                <span className="mt-1 hidden font-mono text-[0.65rem] leading-tight sm:block">
                  <span className="text-emerald-300">+{formatCompact(day.added)}</span>{" "}
                  <span className="text-rose-300">-{formatCompact(day.removed)}</span>
                </span>
              </span>
            ) : (
              <span />
            )}
          </button>
        );
      })}

      <div
        className="hidden min-h-20 flex-col justify-between rounded-lg border border-dashed border-border/60 p-2 sm:flex"
        {...bind(() => (
          <StatTooltip
            title="Week total"
            commits={week.commits}
            added={week.added}
            removed={week.removed}
            footer={`${week.activeDays} active days`}
          />
        ))}
      >
        <span className="text-[0.7rem] text-muted-foreground">{week.activeDays}/7 days</span>
        <span className="flex flex-col">
          <span className="font-mono text-lg leading-none font-semibold">
            {formatNumber(week.commits)}
          </span>
          <span className="mt-1 font-mono text-[0.65rem] leading-tight text-muted-foreground">
            {week.commits > 0
              ? `${week.added - week.removed >= 0 ? "+" : ""}${formatCompact(week.added - week.removed)} net`
              : "–"}
          </span>
        </span>
      </div>
    </>
  );
}
