import { GitCommitHorizontal } from "lucide-react";

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
import { cn } from "@/lib/utils";
import type { CheckinDay, CheckinTotals } from "@/lib/git/types";

interface CheckinsViewProps {
  days: CheckinDay[] | null;
  totals: CheckinTotals | null;
}

const numberFormat = new Intl.NumberFormat();

function parseDay(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDay(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(parseDay(value));
}

function formatNet(day: Pick<CheckinDay, "added" | "removed">): string {
  const net = day.added - day.removed;
  return `${net > 0 ? "+" : ""}${numberFormat.format(net)}`;
}

function describeDay(day: CheckinDay): string {
  return `${formatDay(day.date)}: ${day.commits} commits, +${numberFormat.format(day.added)} / -${numberFormat.format(day.removed)} lines`;
}

function CheckinsSkeleton() {
  return (
    <Card className="border-border/80 bg-card/90 py-0">
      <CardContent className="space-y-4 p-5">
        <div className="flex gap-4">
          {[0, 1, 2, 3].map((tile) => (
            <Skeleton key={tile} className="h-16 flex-1" />
          ))}
        </div>
        <Skeleton className="h-32 w-full" />
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} className="h-5 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}

function NoCheckins() {
  return (
    <Card className="border-dashed border-border/80 bg-card/65">
      <CardContent className="flex min-h-72 flex-col items-center justify-center px-6 text-center">
        <div className="mb-5 rounded-2xl border border-border/80 bg-muted/25 p-4">
          <GitCommitHorizontal className="size-7 text-muted-foreground" aria-hidden="true" />
        </div>
        <h2 className="text-lg font-medium">No commits in the last 30 days</h2>
        <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
          No commits by the configured author were found in the repositories under
          the scanned project roots.
        </p>
      </CardContent>
    </Card>
  );
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-muted/20 px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("mt-1 font-mono text-2xl font-semibold tracking-tight", tone)}>
        {value}
      </div>
    </div>
  );
}

function CommitBars({ days }: { days: CheckinDay[] }) {
  const maxCommits = Math.max(...days.map((day) => day.commits), 1);

  return (
    <div
      className="flex h-32 items-end gap-1"
      role="img"
      aria-label="Commits per day over the last 30 days"
    >
      {days.map((day) => (
        <div
          key={day.date}
          className="flex h-full flex-1 items-end"
          title={describeDay(day)}
        >
          <div
            className={cn(
              "w-full rounded-sm",
              day.commits > 0 ? "bg-primary/80" : "bg-border/60",
            )}
            style={{
              height:
                day.commits > 0
                  ? `${Math.max((day.commits / maxCommits) * 100, 6)}%`
                  : "3px",
            }}
          />
        </div>
      ))}
    </div>
  );
}

export function CheckinsView({ days, totals }: CheckinsViewProps) {
  if (days === null || totals === null) {
    return <CheckinsSkeleton />;
  }

  if (totals.commits === 0) {
    return <NoCheckins />;
  }

  const newestFirst = [...days].reverse();

  return (
    <div className="grid gap-3">
      <Card className="border-border/80 bg-card/88 py-0 shadow-2xl shadow-black/20">
        <CardContent className="space-y-5 p-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <SummaryTile label="Commits" value={numberFormat.format(totals.commits)} />
            <SummaryTile
              label="Lines added"
              value={`+${numberFormat.format(totals.added)}`}
              tone="text-emerald-300"
            />
            <SummaryTile
              label="Lines removed"
              value={`-${numberFormat.format(totals.removed)}`}
              tone="text-rose-300"
            />
            <SummaryTile label="Net lines" value={formatNet(totals)} />
          </div>
          <CommitBars days={days} />
          <div className="flex justify-between font-mono text-[0.65rem] text-muted-foreground">
            <span>{formatDay(days[0].date)}</span>
            <span>{formatDay(days[days.length - 1].date)}</span>
          </div>
        </CardContent>
      </Card>

      <Card className="hidden overflow-hidden border-border/80 bg-card/88 py-0 shadow-2xl shadow-black/20 md:block">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-border/70 bg-muted/25 hover:bg-muted/25">
                <TableHead className="pl-5">Date</TableHead>
                <TableHead className="text-right">Commits</TableHead>
                <TableHead className="text-right">Added</TableHead>
                <TableHead className="text-right">Removed</TableHead>
                <TableHead className="pr-5 text-right">Net</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {newestFirst.map((day) => (
                <TableRow
                  key={day.date}
                  className={cn(
                    "border-border/60 font-mono text-xs",
                    day.commits === 0 && "text-muted-foreground/60",
                  )}
                >
                  <TableCell className="pl-5 font-sans text-sm">
                    {formatDay(day.date)}
                  </TableCell>
                  <TableCell className="text-right">{day.commits}</TableCell>
                  <TableCell className="text-right">
                    {day.commits > 0 ? `+${numberFormat.format(day.added)}` : "–"}
                  </TableCell>
                  <TableCell className="text-right">
                    {day.commits > 0 ? `-${numberFormat.format(day.removed)}` : "–"}
                  </TableCell>
                  <TableCell className="pr-5 text-right">
                    {day.commits > 0 ? formatNet(day) : "–"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-2 md:hidden">
        {newestFirst.map((day) => (
          <div
            key={day.date}
            className={cn(
              "flex items-center justify-between rounded-lg border border-border/70 bg-card/80 px-4 py-3 text-sm",
              day.commits === 0 && "text-muted-foreground/60",
            )}
          >
            <span>{formatDay(day.date)}</span>
            <span className="flex items-center gap-3 font-mono text-xs">
              <span>{day.commits}</span>
              {day.commits > 0 && (
                <>
                  <span className="text-emerald-300">+{numberFormat.format(day.added)}</span>
                  <span className="text-rose-300">-{numberFormat.format(day.removed)}</span>
                </>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
