"use client";

import { X } from "lucide-react";
import { useState } from "react";

import {
  LineDelta,
  RepoDot,
  formatDayLong,
  formatDayShort,
  formatTime,
} from "@/components/checkins/shared";
import { Button } from "@/components/ui/button";
import { commitDateKey, formatNumber } from "@/lib/git/checkin-stats";
import type { CheckinCommit, CheckinRepository } from "@/lib/git/types";

const PAGE_SIZE = 100;

function CommitRow({
  commit,
  repositories,
}: {
  commit: CheckinCommit;
  repositories: readonly CheckinRepository[];
}) {
  return (
    <li className="grid grid-cols-[3rem_1fr_auto] items-baseline gap-x-3 gap-y-0.5 px-1 py-1.5 text-sm hover:bg-muted/25 sm:grid-cols-[3rem_9rem_1fr_auto]">
      <span className="font-mono text-xs text-muted-foreground">{formatTime(commit.at)}</span>
      <span className="order-last col-span-3 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground sm:order-none sm:col-span-1">
        <RepoDot index={commit.repo} />
        <span className="truncate">{repositories[commit.repo]?.name}</span>
      </span>
      <span className="min-w-0 truncate" title={commit.subject}>
        {commit.subject || <span className="text-muted-foreground">(no message)</span>}
      </span>
      <LineDelta added={commit.added} removed={commit.removed} compact className="text-xs" />
    </li>
  );
}

/** Commits grouped by day, newest first, loaded in pages of 100. */
export function CommitList({
  commits,
  repositories,
}: {
  commits: readonly CheckinCommit[];
  repositories: readonly CheckinRepository[];
}) {
  const [visible, setVisible] = useState(PAGE_SIZE);

  if (commits.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No commits match the current filters.
      </p>
    );
  }

  const shown = commits.slice(0, visible);
  const groups: { key: string; items: CheckinCommit[] }[] = [];
  for (const commit of shown) {
    const key = commitDateKey(commit);
    const last = groups[groups.length - 1];
    if (last?.key === key) {
      last.items.push(commit);
    } else {
      groups.push({ key, items: [commit] });
    }
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <section key={group.key}>
          <h4 className="sticky top-0 z-10 mb-1 flex items-center justify-between border-b border-border/60 bg-card/95 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
            <span>{formatDayShort(group.key)}</span>
            <span className="font-mono">{group.items.length}</span>
          </h4>
          <ul>
            {group.items.map((commit) => (
              <CommitRow key={commit.hash} commit={commit} repositories={repositories} />
            ))}
          </ul>
        </section>
      ))}

      {commits.length > shown.length && (
        <div className="flex items-center justify-center gap-3 pt-1 text-xs text-muted-foreground">
          <span>
            Showing {formatNumber(shown.length)} of {formatNumber(commits.length)}
          </span>
          <Button variant="outline" size="sm" onClick={() => setVisible((count) => count + PAGE_SIZE)}>
            Show more
          </Button>
        </div>
      )}
    </div>
  );
}

export function DayDetail({
  dayKey,
  commits,
  repositories,
  onClose,
}: {
  dayKey: string;
  commits: readonly CheckinCommit[];
  repositories: readonly CheckinRepository[];
  onClose: () => void;
}) {
  const added = commits.reduce((sum, commit) => sum + commit.added, 0);
  const removed = commits.reduce((sum, commit) => sum + commit.removed, 0);
  const ordered = [...commits].sort((left, right) => left.at - right.at);

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-medium">{formatDayLong(dayKey)}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {formatNumber(commits.length)} commits · <LineDelta added={added} removed={removed} />
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Close day details" onClick={onClose}>
          <X />
        </Button>
      </div>
      {commits.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">No commits on this day.</p>
      ) : (
        <ul className="max-h-96 overflow-y-auto pr-1">
          {ordered.map((commit) => (
            <CommitRow key={commit.hash} commit={commit} repositories={repositories} />
          ))}
        </ul>
      )}
    </div>
  );
}
