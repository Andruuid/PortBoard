"use client";

import { useMemo } from "react";

import { useTooltipBinding } from "@/components/checkins/chart-tooltip";
import { METRICS, WEEKDAY_LABELS, levelClass } from "@/components/checkins/shared";
import {
  formatNumber,
  levelFor,
  levelThresholds,
  weekdayHourMatrix,
  type CheckinMetric,
} from "@/lib/git/checkin-stats";
import type { CheckinCommit } from "@/lib/git/types";
import { cn } from "@/lib/utils";

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const NIGHT_HOURS = new Set([22, 23, 0, 1, 2, 3, 4]);
const EARLY_HOURS = new Set([5, 6, 7, 8]);

function formatHour(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

function percent(part: number, total: number): string {
  return total > 0 ? `${Math.round((part / total) * 100)}%` : "–";
}

function SlotTooltip({
  title,
  value,
  label,
  commits,
}: {
  title: string;
  value: number;
  label: string;
  commits: number;
}) {
  return (
    <div className="space-y-1">
      <div className="font-medium">{title}</div>
      <div className="font-mono">
        {formatNumber(value)} <span className="text-muted-foreground">{label}</span>
      </div>
      {label !== "commits" && (
        <div className="font-mono text-muted-foreground">{formatNumber(commits)} commits</div>
      )}
    </div>
  );
}

function Insight({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
      <div className="text-[0.7rem] text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-mono text-lg font-semibold tracking-tight">{value}</div>
      {hint && <div className="text-[0.65rem] text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function RhythmView({
  commits,
  metric,
}: {
  commits: readonly CheckinCommit[];
  metric: CheckinMetric;
}) {
  const bind = useTooltipBinding();
  const style = METRICS[metric];

  const model = useMemo(() => {
    const matrix = weekdayHourMatrix(commits, metric);
    const commitMatrix = weekdayHourMatrix(commits, "commits");
    const weekdayTotals = matrix.map((row) => row.reduce((sum, value) => sum + value, 0));
    const hourTotals = HOURS.map((hour) => matrix.reduce((sum, row) => sum + row[hour], 0));
    const total = weekdayTotals.reduce((sum, value) => sum + value, 0);
    const thresholds = levelThresholds(matrix.flat());

    let peak = { weekday: 0, hour: 0, value: 0 };
    matrix.forEach((row, weekday) =>
      row.forEach((value, hour) => {
        if (value > peak.value) peak = { weekday, hour, value };
      }),
    );

    const sumHours = (hours: Set<number>) =>
      hourTotals.reduce((sum, value, hour) => sum + (hours.has(hour) ? value : 0), 0);

    return {
      matrix,
      commitMatrix,
      weekdayTotals,
      hourTotals,
      total,
      thresholds,
      peak,
      nightOwl: sumHours(NIGHT_HOURS),
      earlyBird: sumHours(EARLY_HOURS),
      weekend: weekdayTotals[5] + weekdayTotals[6],
      busiestWeekday: weekdayTotals.indexOf(Math.max(...weekdayTotals)),
      busiestHour: hourTotals.indexOf(Math.max(...hourTotals)),
      maxHour: Math.max(...hourTotals, 1),
    };
  }, [commits, metric]);

  if (model.total === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        Nothing to show for this selection.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Insight
          label="Peak slot"
          value={`${WEEKDAY_LABELS[model.peak.weekday]} ${formatHour(model.peak.hour)}`}
          hint={`${formatNumber(model.peak.value)} ${style.label.toLowerCase()}`}
        />
        <Insight
          label="Busiest weekday"
          value={WEEKDAY_LABELS[model.busiestWeekday]}
          hint={`${percent(model.weekdayTotals[model.busiestWeekday], model.total)} of the total`}
        />
        <Insight
          label="Night owl · 22:00–05:00"
          value={percent(model.nightOwl, model.total)}
          hint={`Early bird 05:00–09:00: ${percent(model.earlyBird, model.total)}`}
        />
        <Insight
          label="Weekend share"
          value={percent(model.weekend, model.total)}
          hint={`Peak hour overall: ${formatHour(model.busiestHour)}`}
        />
      </div>

      <div className="overflow-x-auto">
        <div
          className="grid min-w-[640px] items-center gap-[3px]"
          style={{ gridTemplateColumns: "2.5rem repeat(24, minmax(0, 1fr)) 3.5rem" }}
        >
          <span />
          {HOURS.map((hour) => (
            <span key={hour} className="text-center font-mono text-[0.6rem] text-muted-foreground">
              {hour % 3 === 0 ? String(hour).padStart(2, "0") : ""}
            </span>
          ))}
          <span className="text-right text-[0.6rem] text-muted-foreground">Total</span>

          {model.matrix.map((row, weekday) => (
            <RhythmRow
              key={weekday}
              weekday={weekday}
              row={row}
              commitRow={model.commitMatrix[weekday]}
              total={model.weekdayTotals[weekday]}
              thresholds={model.thresholds}
              levels={style.levels}
              bind={bind}
              label={style.label.toLowerCase()}
            />
          ))}

          <span className="self-end text-[0.6rem] text-muted-foreground">By hour</span>
          {model.hourTotals.map((value, hour) => (
            <div
              key={hour}
              className="flex h-14 items-end"
              {...bind(() => (
                <SlotTooltip
                  title={`${formatHour(hour)}–${formatHour((hour + 1) % 24)} · all weekdays`}
                  value={value}
                  label={style.label.toLowerCase()}
                  commits={model.commitMatrix.reduce((sum, row) => sum + row[hour], 0)}
                />
              ))}
            >
              <div
                className={cn("w-full rounded-t-sm", style.levels[4])}
                style={{ height: `${Math.max((value / model.maxHour) * 100, value > 0 ? 4 : 0)}%` }}
              />
            </div>
          ))}
          <span />
        </div>
      </div>
    </div>
  );
}

function RhythmRow({
  weekday,
  row,
  commitRow,
  total,
  thresholds,
  levels,
  bind,
  label,
}: {
  weekday: number;
  row: readonly number[];
  commitRow: readonly number[];
  total: number;
  thresholds: readonly [number, number, number];
  levels: readonly [string, string, string, string, string];
  bind: ReturnType<typeof useTooltipBinding>;
  label: string;
}) {
  return (
    <>
      <span className="text-[0.7rem] text-muted-foreground">{WEEKDAY_LABELS[weekday]}</span>
      {row.map((value, hour) => (
        <div
          key={hour}
          className={cn("h-6 rounded-[3px] hover:ring-1 hover:ring-foreground/60", levelClass(levelFor(value, thresholds), levels))}
          {...bind(() => (
            <SlotTooltip
              title={`${WEEKDAY_LABELS[weekday]} ${formatHour(hour)}–${formatHour((hour + 1) % 24)}`}
              value={value}
              label={label}
              commits={commitRow[hour]}
            />
          ))}
        />
      ))}
      <span className="text-right font-mono text-[0.7rem] text-muted-foreground">
        {formatNumber(total)}
      </span>
    </>
  );
}
