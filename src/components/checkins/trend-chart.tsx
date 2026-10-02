"use client";

import { useMemo, useState } from "react";

import { useTooltipBinding } from "@/components/checkins/chart-tooltip";
import { DayTooltip, METRICS, StatTooltip } from "@/components/checkins/shared";
import {
  bucketSeries,
  formatCompact,
  metricValue,
  movingAverage,
  niceScale,
  pickGranularity,
  type CheckinMetric,
  type DayStat,
  type Granularity,
} from "@/lib/git/checkin-stats";
import type { CheckinRepository } from "@/lib/git/types";

const WIDTH = 1000;
const HEIGHT = 280;
const PAD = { left: 48, right: 12, top: 14, bottom: 28 };
const AVERAGE_WINDOW: Record<Granularity, number> = { day: 7, week: 4, month: 3 };
const AVERAGE_LABEL: Record<Granularity, string> = {
  day: "7-day average",
  week: "4-week average",
  month: "3-month average",
};

interface TrendChartProps {
  series: readonly DayStat[];
  metric: CheckinMetric;
  repositories: readonly CheckinRepository[];
  selectedKey: string | null;
  onSelectDay: (key: string) => void;
}

export function TrendChart({
  series,
  metric,
  repositories,
  selectedKey,
  onSelectDay,
}: TrendChartProps) {
  const bind = useTooltipBinding();
  const [hovered, setHovered] = useState<number | null>(null);
  const style = METRICS[metric];
  const granularity = pickGranularity(series.length);

  const chart = useMemo(() => {
    const buckets = bucketSeries(series, granularity);
    const totals = buckets.map((bucket) => metricValue(bucket, metric));
    const scale = niceScale(Math.max(...totals, 0));
    const innerWidth = WIDTH - PAD.left - PAD.right;
    const innerHeight = HEIGHT - PAD.top - PAD.bottom;
    const band = innerWidth / buckets.length;
    const barWidth = Math.max(1.5, band * 0.74);
    const yFor = (value: number) => PAD.top + innerHeight * (1 - value / scale.max);
    const average = movingAverage(totals, AVERAGE_WINDOW[granularity]);
    const ticks = Array.from(
      { length: Math.round(scale.max / scale.step) + 1 },
      (_, index) => index * scale.step,
    );
    const labelEvery = Math.max(1, Math.ceil(buckets.length / 8));

    return { buckets, totals, scale, innerHeight, band, barWidth, yFor, average, ticks, labelEvery };
  }, [series, granularity, metric]);

  const { buckets, band, barWidth, yFor, average, ticks, labelEvery } = chart;
  const baseline = yFor(0);
  const averagePath = average
    .map((value, index) => `${index === 0 ? "M" : "L"}${PAD.left + band * index + band / 2},${yFor(value)}`)
    .join(" ");

  return (
    <div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-label={`${style.label} over the selected period`}
        onMouseLeave={() => setHovered(null)}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={yFor(tick)}
              y2={yFor(tick)}
              className="stroke-border"
              strokeDasharray={tick === 0 ? undefined : "3 4"}
            />
            <text
              x={PAD.left - 8}
              y={yFor(tick)}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-muted-foreground font-mono text-[11px]"
            >
              {formatCompact(tick)}
            </text>
          </g>
        ))}

        {buckets.map((bucket, index) => {
          const x = PAD.left + band * index + (band - barWidth) / 2;
          const isSelected = granularity === "day" && bucket.key === selectedKey;

          return (
            <g key={bucket.key}>
              {hovered === index && (
                <rect
                  x={PAD.left + band * index}
                  y={PAD.top}
                  width={band}
                  height={baseline - PAD.top}
                  className="fill-foreground/6"
                />
              )}
              {metric === "churn" ? (
                <>
                  <rect
                    x={x}
                    width={barWidth}
                    y={yFor(bucket.added)}
                    height={Math.max(0, baseline - yFor(bucket.added))}
                    className="fill-emerald-400/85"
                  />
                  <rect
                    x={x}
                    width={barWidth}
                    y={yFor(bucket.added + bucket.removed)}
                    height={Math.max(0, yFor(bucket.added) - yFor(bucket.added + bucket.removed))}
                    className="fill-rose-400/85"
                  />
                </>
              ) : (
                <rect
                  x={x}
                  width={barWidth}
                  y={yFor(metricValue(bucket, metric))}
                  height={Math.max(0, baseline - yFor(metricValue(bucket, metric)))}
                  rx={Math.min(3, barWidth / 3)}
                  className={`${style.fill} ${hovered === index || isSelected ? "opacity-100" : "opacity-80"}`}
                />
              )}
              {isSelected && (
                <rect
                  x={x - 1}
                  y={PAD.top}
                  width={barWidth + 2}
                  height={baseline - PAD.top}
                  className="fill-none stroke-foreground"
                  rx={3}
                />
              )}
              {index % labelEvery === 0 && (
                <text
                  x={PAD.left + band * index + band / 2}
                  y={HEIGHT - 8}
                  textAnchor="middle"
                  className="fill-muted-foreground font-mono text-[11px]"
                >
                  {granularity === "week" ? bucket.label.replace("Week of ", "") : bucket.label}
                </text>
              )}
            </g>
          );
        })}

        <path
          d={averagePath}
          fill="none"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          strokeDasharray="5 4"
          className="stroke-foreground/75"
        />

        {buckets.map((bucket, index) => {
          const handlers = bind(() =>
            granularity === "day" ? (
              <DayTooltip day={series[index]} repositories={repositories} />
            ) : (
              <StatTooltip
                title={bucket.label}
                commits={bucket.commits}
                added={bucket.added}
                removed={bucket.removed}
              />
            ),
          );

          return (
            <rect
              key={`hit-${bucket.key}`}
              x={PAD.left + band * index}
              y={PAD.top}
              width={band}
              height={HEIGHT - PAD.top - PAD.bottom}
              fill="transparent"
              className={granularity === "day" ? "cursor-pointer" : undefined}
              onClick={granularity === "day" ? () => onSelectDay(bucket.key) : undefined}
              onMouseEnter={(event) => {
                setHovered(index);
                handlers.onMouseEnter(event);
              }}
              onMouseMove={handlers.onMouseMove}
              onMouseLeave={handlers.onMouseLeave}
            />
          );
        })}
      </svg>

      <div className="mt-1 flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-[0.7rem] text-muted-foreground">
        {metric === "churn" ? (
          <>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-emerald-400/85" /> added
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-rose-400/85" /> removed
            </span>
          </>
        ) : (
          <span className="flex items-center gap-1.5">
            <span className={`size-2.5 rounded-sm ${style.levels[4]}`} /> {style.label.toLowerCase()} per{" "}
            {granularity}
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <span className="w-4 border-t-2 border-dashed border-foreground/75" />
          {AVERAGE_LABEL[granularity]}
        </span>
      </div>
    </div>
  );
}
