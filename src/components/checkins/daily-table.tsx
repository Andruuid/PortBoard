"use client";

import { formatDayShort } from "@/components/checkins/shared";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatNumber, formatSigned, type DayStat } from "@/lib/git/checkin-stats";
import { cn } from "@/lib/utils";

export function DailyTable({
  series,
  selectedKey,
  onSelect,
}: {
  series: readonly DayStat[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  const newestFirst = [...series].reverse();

  return (
    <div className="max-h-96 overflow-y-auto rounded-lg border border-border/60">
      <Table>
        <TableHeader>
          <TableRow className="border-border/70 bg-muted/25 hover:bg-muted/25">
            <TableHead className="pl-4">Date</TableHead>
            <TableHead className="text-right">Commits</TableHead>
            <TableHead className="text-right">Added</TableHead>
            <TableHead className="text-right">Removed</TableHead>
            <TableHead className="pr-4 text-right">Net</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {newestFirst.map((day) => (
            <TableRow
              key={day.key}
              onClick={() => onSelect(day.key)}
              aria-selected={day.key === selectedKey}
              className={cn(
                "cursor-pointer border-border/60 font-mono text-xs",
                day.commits === 0 && "text-muted-foreground/60",
                day.key === selectedKey && "bg-primary/8",
              )}
            >
              <TableCell className="pl-4 font-sans text-sm">{formatDayShort(day.key)}</TableCell>
              <TableCell className="text-right">{day.commits}</TableCell>
              <TableCell className="text-right">
                {day.commits > 0 ? `+${formatNumber(day.added)}` : "–"}
              </TableCell>
              <TableCell className="text-right">
                {day.commits > 0 ? `-${formatNumber(day.removed)}` : "–"}
              </TableCell>
              <TableCell className="pr-4 text-right">
                {day.commits > 0 ? formatSigned(day.added - day.removed) : "–"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
