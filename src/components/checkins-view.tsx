"use client";

import {
  ArrowDown,
  ArrowUp,
  Calendar,
  CalendarDays,
  ChartColumn,
  Clock,
  FolderGit2,
  GitCommitHorizontal,
  List,
  ListFilter,
  Search,
  X,
} from "lucide-react";
import { useDeferredValue, useMemo, useState, type ReactNode } from "react";

import { ChartTooltipProvider } from "@/components/checkins/chart-tooltip";
import { CommitList, DayDetail } from "@/components/checkins/commit-list";
import { DailyTable } from "@/components/checkins/daily-table";
import { MonthCalendar } from "@/components/checkins/month-calendar";
import { ReposView } from "@/components/checkins/repos-view";
import { RhythmView } from "@/components/checkins/rhythm-view";
import { RepoDot, Segmented, formatDayShort } from "@/components/checkins/shared";
import { TrendChart } from "@/components/checkins/trend-chart";
import { MonthlyBreakdown, YearHeatmap } from "@/components/checkins/year-heatmap";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  addDays,
  buildSeries,
  commitDateKey,
  endOfMonth,
  filterCommits,
  formatNumber,
  groupByDay,
  monthsBreakdown,
  startOfDay,
  startOfMonth,
  summarize,
  type CheckinMetric,
  type RangeSummary,
} from "@/lib/git/checkin-stats";
import type { CheckinsResponse } from "@/lib/git/types";
import { cn } from "@/lib/utils";

type SubView = "trends" | "year" | "month" | "rhythm" | "repos" | "commits";

const VIEW_OPTIONS: { value: SubView; label: string; icon: ReactNode }[] = [
  { value: "trends", label: "Trends", icon: <ChartColumn className="size-3.5" aria-hidden="true" /> },
  { value: "year", label: "Year", icon: <CalendarDays className="size-3.5" aria-hidden="true" /> },
  { value: "month", label: "Month", icon: <Calendar className="size-3.5" aria-hidden="true" /> },
  { value: "rhythm", label: "Rhythm", icon: <Clock className="size-3.5" aria-hidden="true" /> },
  { value: "repos", label: "Repos", icon: <FolderGit2 className="size-3.5" aria-hidden="true" /> },
  { value: "commits", label: "Commits", icon: <List className="size-3.5" aria-hidden="true" /> },
];

const METRIC_OPTIONS: { value: CheckinMetric; label: string }[] = [
  { value: "commits", label: "Commits" },
  { value: "added", label: "Added" },
  { value: "removed", label: "Removed" },
  { value: "churn", label: "Changed" },
];

const RANGE_OPTIONS = [
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: 182, label: "6 months" },
  { value: 365, label: "1 year" },
];

const DAILY_TABLE_MAX_DAYS = 120;

function CheckinsSkeleton() {
  return (
    <Card className="border-border/80 bg-card/90 py-0">
      <CardContent className="space-y-4 p-5">
        <div className="flex gap-4">
          {[0, 1, 2, 3].map((tile) => (
            <Skeleton key={tile} className="h-16 flex-1" />
          ))}
        </div>
        <Skeleton className="h-40 w-full" />
        <p className="text-center text-xs text-muted-foreground">
          Reading a year of commit history. The first scan can take a minute; later refreshes only
          read recent commits.
        </p>
      </CardContent>
    </Card>
  );
}

function NoCheckins({ windowDays }: { windowDays: number }) {
  return (
    <Card className="border-dashed border-border/80 bg-card/65">
      <CardContent className="flex min-h-72 flex-col items-center justify-center px-6 text-center">
        <div className="mb-5 rounded-2xl border border-border/80 bg-muted/25 p-4">
          <GitCommitHorizontal className="size-7 text-muted-foreground" aria-hidden="true" />
        </div>
        <h2 className="text-lg font-medium">No commits in the last {windowDays} days</h2>
        <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
          No commits by the configured author were found in the repositories under the scanned
          project roots.
        </p>
      </CardContent>
    </Card>
  );
}

function Delta({ current, previous }: { current: number; previous: number | null }) {
  if (previous === null || (previous === 0 && current === 0)) {
    return null;
  }
  if (previous === 0) {
    return <span className="text-[0.7rem] text-emerald-300">new</span>;
  }

  const percent = Math.round(((current - previous) / previous) * 100);
  if (percent === 0) {
    return <span className="text-[0.7rem] text-muted-foreground">±0%</span>;
  }

  const Icon = percent > 0 ? ArrowUp : ArrowDown;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-[0.7rem]",
        percent > 0 ? "text-emerald-300" : "text-rose-300",
      )}
      title="Compared with the previous period of the same length"
    >
      <Icon className="size-3" aria-hidden="true" />
      {Math.abs(percent)}%
    </span>
  );
}

function SummaryTile({
  label,
  value,
  hint,
  tone,
  delta,
  onClick,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
  delta?: ReactNode;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{label}</span>
        {delta}
      </div>
      <div className={cn("mt-1 font-mono text-2xl font-semibold tracking-tight", tone)}>{value}</div>
      <div className="mt-0.5 min-h-4 truncate text-[0.7rem] text-muted-foreground">{hint}</div>
    </>
  );
  const className = "rounded-lg border border-border/70 bg-muted/20 px-4 py-3 text-left";

  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={cn(className, "transition-colors hover:border-foreground/40")}
    >
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
}

function SummaryTiles({
  summary,
  previous,
  endsToday,
  onSelectDay,
}: {
  summary: RangeSummary;
  previous: RangeSummary | null;
  endsToday: boolean;
  onSelectDay: (key: string) => void;
}) {
  const busiest = summary.busiest;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
      <SummaryTile
        label="Commits"
        value={formatNumber(summary.commits)}
        hint={
          summary.activeDays > 0
            ? `${summary.averagePerActiveDay.toFixed(1)} per active day`
            : undefined
        }
        delta={<Delta current={summary.commits} previous={previous?.commits ?? null} />}
      />
      <SummaryTile
        label="Lines added"
        value={`+${formatNumber(summary.added)}`}
        tone="text-emerald-300"
        delta={<Delta current={summary.added} previous={previous?.added ?? null} />}
      />
      <SummaryTile
        label="Lines removed"
        value={`-${formatNumber(summary.removed)}`}
        tone="text-rose-300"
        delta={<Delta current={summary.removed} previous={previous?.removed ?? null} />}
      />
      <SummaryTile
        label="Active days"
        value={`${summary.activeDays}/${summary.totalDays}`}
        hint={`${Math.round((summary.activeDays / Math.max(summary.totalDays, 1)) * 100)}% of days`}
        delta={<Delta current={summary.activeDays} previous={previous?.activeDays ?? null} />}
      />
      <SummaryTile
        label="Longest streak"
        value={`${summary.longestStreak} ${summary.longestStreak === 1 ? "day" : "days"}`}
        hint={endsToday ? `Current: ${summary.currentStreak}` : undefined}
      />
      <SummaryTile
        label="Busiest day"
        value={busiest ? formatNumber(busiest.commits) : "–"}
        hint={busiest ? formatDayShort(busiest.key) : undefined}
        onClick={busiest ? () => onSelectDay(busiest.key) : undefined}
      />
    </div>
  );
}

export function CheckinsView({ data }: { data: CheckinsResponse | null }) {
  if (data === null) {
    return <CheckinsSkeleton />;
  }
  if (data.commits.length === 0) {
    return <NoCheckins windowDays={data.windowDays} />;
  }

  return (
    <ChartTooltipProvider>
      <CheckinsDashboard data={data} />
    </ChartTooltipProvider>
  );
}

function CheckinsDashboard({ data }: { data: CheckinsResponse }) {
  const [view, setView] = useState<SubView>("trends");
  const [metric, setMetric] = useState<CheckinMetric>("commits");
  const [rangeDays, setRangeDays] = useState(30);
  const [selectedRepos, setSelectedRepos] = useState<ReadonlySet<number> | null>(null);
  const [reposOpen, setReposOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [monthStart, setMonthStart] = useState<Date | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const deferredQuery = useDeferredValue(query);

  const today = useMemo(() => startOfDay(new Date(data.scannedAt)), [data.scannedAt]);
  const windowStart = useMemo(
    () => addDays(today, -(data.windowDays - 1)),
    [today, data.windowDays],
  );

  const repoCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const commit of data.commits) {
      counts.set(commit.repo, (counts.get(commit.repo) ?? 0) + 1);
    }
    return [...counts.entries()].sort((left, right) => right[1] - left[1]);
  }, [data.commits]);

  const filtered = useMemo(
    () => filterCommits(data.commits, { repos: selectedRepos, query: deferredQuery }),
    [data.commits, selectedRepos, deferredQuery],
  );
  const byDay = useMemo(() => groupByDay(filtered), [filtered]);

  const month = useMemo(() => monthStart ?? startOfMonth(today), [monthStart, today]);
  const rangeOption = RANGE_OPTIONS.find((option) => option.value === rangeDays);

  const scope = useMemo(() => {
    if (view === "year") {
      return { start: windowStart, end: today, label: "Last 12 months" };
    }
    if (view === "month") {
      const lastOfMonth = endOfMonth(month);
      return {
        start: month > windowStart ? month : windowStart,
        end: lastOfMonth < today ? lastOfMonth : today,
        label: new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(month),
      };
    }
    return {
      start: addDays(today, -(rangeDays - 1)),
      end: today,
      label: `Last ${rangeOption?.label ?? `${rangeDays} days`}`,
    };
  }, [view, month, rangeDays, rangeOption, today, windowStart]);

  const scopeSeries = useMemo(
    () => buildSeries(byDay, scope.start, scope.end),
    [byDay, scope],
  );
  const endsToday = scope.end.getTime() >= today.getTime();
  const summary = useMemo(() => summarize(scopeSeries, endsToday), [scopeSeries, endsToday]);
  const previous = useMemo(() => {
    const previousStart = addDays(scope.start, -scopeSeries.length);
    if (previousStart < windowStart) {
      return null;
    }
    return summarize(buildSeries(byDay, previousStart, addDays(scope.start, -1)), false);
  }, [byDay, scope, scopeSeries.length, windowStart]);

  const scopeCommits = useMemo(() => {
    const from = scope.start.getTime() / 1000;
    const until = addDays(scope.end, 1).getTime() / 1000;
    return filtered.filter((commit) => commit.at >= from && commit.at < until);
  }, [filtered, scope]);

  const months = useMemo(
    () => (view === "year" ? monthsBreakdown(byDay, windowStart, today) : []),
    [view, byDay, windowStart, today],
  );
  const dayCommits = useMemo(
    () => (selectedDay ? filtered.filter((commit) => commitDateKey(commit) === selectedDay) : []),
    [filtered, selectedDay],
  );

  const filtersActive = selectedRepos !== null || query.trim() !== "";
  const showMetric = view !== "commits";
  const showRange = view === "trends" || view === "rhythm" || view === "repos" || view === "commits";
  const showDayDetail = view === "trends" || view === "year" || view === "month";

  const selectDay = (key: string) => setSelectedDay((current) => (current === key ? null : key));

  const changeView = (next: SubView) => {
    setView(next);
    setSelectedDay(null);
  };

  const changeMonth = (next: Date) => {
    setMonthStart(next);
    setSelectedDay(null);
  };

  const toggleRepo = (repo: number) => {
    setSelectedRepos((current) => {
      if (current === null) {
        return new Set([repo]);
      }
      const next = new Set(current);
      if (next.has(repo)) {
        next.delete(repo);
      } else {
        next.add(repo);
      }
      return next.size === 0 || next.size === repoCounts.length ? null : next;
    });
  };

  const isolateRepo = (repo: number) =>
    setSelectedRepos((current) => (current?.size === 1 && current.has(repo) ? null : new Set([repo])));

  const resetFilters = () => {
    setSelectedRepos(null);
    setQuery("");
  };

  const repoButtonLabel =
    selectedRepos === null
      ? `All ${repoCounts.length} repositories`
      : `${selectedRepos.size} of ${repoCounts.length} repositories`;

  return (
    <div className="grid gap-3">
      <Card className="border-border/80 bg-card/88 py-0 shadow-2xl shadow-black/20">
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Segmented label="View" options={VIEW_OPTIONS} value={view} onChange={changeView} />
            <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
              {showMetric && (
                <Segmented
                  label="Metric"
                  options={METRIC_OPTIONS}
                  value={metric}
                  onChange={setMetric}
                />
              )}
              {showRange && (
                <Segmented
                  label="Time range"
                  options={RANGE_OPTIONS}
                  value={rangeDays}
                  onChange={setRangeDays}
                />
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="relative block w-full sm:w-72">
              <span className="sr-only">Search commit messages</span>
              <Search
                className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground"
                aria-hidden="true"
              />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search commit messages or hashes…"
                className="h-9 w-full rounded-lg border border-border/70 bg-card/65 pr-3 pl-8 text-sm outline-none placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
              />
            </label>
            <Button
              variant="outline"
              size="lg"
              aria-expanded={reposOpen}
              onClick={() => setReposOpen((open) => !open)}
              className={cn(selectedRepos !== null && "border-primary/50 text-primary")}
            >
              <ListFilter data-icon="inline-start" />
              {repoButtonLabel}
            </Button>
            {filtersActive && (
              <Button variant="ghost" size="lg" onClick={resetFilters}>
                <X data-icon="inline-start" />
                Reset filters
              </Button>
            )}
            {filtersActive && (
              <span className="text-xs text-muted-foreground">
                {formatNumber(filtered.length)} of {formatNumber(data.commits.length)} commits match
              </span>
            )}
          </div>

          {reposOpen && (
            <div className="rounded-lg border border-border/70 bg-muted/15 p-3">
              <div className="mb-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>Click to isolate a repository, click more to add them.</span>
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={selectedRepos === null}
                  onClick={() => setSelectedRepos(null)}
                >
                  Show all
                </Button>
              </div>
              <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
                {repoCounts.map(([repo, count]) => {
                  const active = selectedRepos === null || selectedRepos.has(repo);
                  return (
                    <button
                      key={repo}
                      type="button"
                      aria-pressed={selectedRepos !== null && active}
                      onClick={() => toggleRepo(repo)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
                        active
                          ? "border-border bg-card text-foreground"
                          : "border-border/50 text-muted-foreground/60 hover:text-foreground",
                        selectedRepos !== null && active && "border-primary/60 bg-primary/10",
                      )}
                    >
                      <RepoDot index={repo} />
                      {data.repositories[repo]?.name}
                      <span className="font-mono text-[0.65rem] text-muted-foreground">{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/80 bg-card/88 py-0 shadow-2xl shadow-black/20">
        <CardContent className="space-y-5 p-4 sm:p-5">
          <div>
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-medium">{scope.label}</h2>
              {previous && (
                <span className="text-[0.7rem] text-muted-foreground">
                  Arrows compare with the previous {scopeSeries.length} days
                </span>
              )}
            </div>
            <SummaryTiles
              summary={summary}
              previous={previous}
              endsToday={endsToday}
              onSelectDay={selectDay}
            />
          </div>

          {filtered.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No commits match the current filters.
            </p>
          ) : (
            <>
              {view === "trends" && (
                <div className="space-y-4">
                  <TrendChart
                    series={scopeSeries}
                    metric={metric}
                    repositories={data.repositories}
                    selectedKey={selectedDay}
                    onSelectDay={selectDay}
                  />
                  {scopeSeries.length <= DAILY_TABLE_MAX_DAYS && (
                    <DailyTable series={scopeSeries} selectedKey={selectedDay} onSelect={selectDay} />
                  )}
                </div>
              )}

              {view === "year" && (
                <div className="space-y-6">
                  <YearHeatmap
                    byDay={byDay}
                    start={windowStart}
                    end={today}
                    metric={metric}
                    selectedKey={selectedDay}
                    onSelect={selectDay}
                    repositories={data.repositories}
                  />
                  <MonthlyBreakdown months={months} metric={metric} />
                </div>
              )}

              {view === "month" && (
                <MonthCalendar
                  byDay={byDay}
                  month={month}
                  windowStart={windowStart}
                  today={today}
                  metric={metric}
                  selectedKey={selectedDay}
                  onSelect={selectDay}
                  onMonthChange={changeMonth}
                  repositories={data.repositories}
                />
              )}

              {view === "rhythm" && <RhythmView commits={scopeCommits} metric={metric} />}

              {view === "repos" && (
                <ReposView
                  commits={scopeCommits}
                  repositories={data.repositories}
                  start={scope.start}
                  end={scope.end}
                  metric={metric}
                  isolated={selectedRepos}
                  onIsolate={isolateRepo}
                />
              )}

              {view === "commits" && (
                <CommitList
                  key={`${rangeDays}-${deferredQuery}`}
                  commits={scopeCommits}
                  repositories={data.repositories}
                />
              )}
            </>
          )}
        </CardContent>
      </Card>

      {showDayDetail && selectedDay && (
        <DayDetail
          dayKey={selectedDay}
          commits={dayCommits}
          repositories={data.repositories}
          onClose={() => setSelectedDay(null)}
        />
      )}
    </div>
  );
}
