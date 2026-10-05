import type { RunningApp } from "@/lib/apps/types";

/**
 * Choose which RunningApp rows to POST to /api/apps/close for a collapsible
 * parent group's "Stop all" action.
 *
 * Supervised stacks share one verified supervisor stopTarget: stopping any
 * supervised child ends the whole tree, so return a single preferred target.
 * Direct (unsupervised) listeners in the same folder are independent, so
 * return every app for parallel verified stops.
 */
export function selectGroupStopTargets(apps: RunningApp[]): RunningApp[] {
  if (apps.length === 0) {
    return [];
  }

  const supervised = apps.filter((app) => app.supervision.kind === "supervised");
  if (supervised.length > 0) {
    const primary = supervised.find((app) => app.portInfo.isPrimary);
    return [primary ?? supervised[0]];
  }

  return [...apps];
}

export function collectGroupPorts(apps: RunningApp[]): number[] {
  return [...new Set(apps.flatMap((app) => app.allPorts))].sort((a, b) => a - b);
}
