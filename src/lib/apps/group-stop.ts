import type { CloseAppResponse, RunningApp } from "@/lib/apps/types";

/**
 * Listeners that share a verified supervisor are scanned with the same
 * `allPorts` set (the stop target's pid and start time). Closing any one of
 * them stops that whole tree, so a group needs only one close per port set.
 * Independent listeners in the same folder have different port sets and are
 * separate stop targets.
 */
export function selectGroupStopTargets(apps: RunningApp[]): RunningApp[] {
  const groups = new Map<string, RunningApp[]>();

  for (const app of apps) {
    const key = stopTargetKey(app);
    const existing = groups.get(key);

    if (existing) {
      existing.push(app);
    } else {
      groups.set(key, [app]);
    }
  }

  return [...groups.values()]
    .map(pickRepresentative)
    .sort((left, right) => left.port - right.port || left.pid - right.pid);
}

export interface GroupStopPlan {
  targets: RunningApp[];
  ports: number[];
  title: string;
  detail: string;
  managedCommands: string[];
}

export function planGroupStop(
  apps: RunningApp[],
  projectName: string,
): GroupStopPlan {
  const targets = selectGroupStopTargets(apps);
  const ports = [
    ...new Set(
      apps.flatMap((app) => (app.allPorts.length > 0 ? app.allPorts : [app.port])),
    ),
  ].sort((left, right) => left - right);

  if (targets.length === 1 && targets[0].supervision.kind === "supervised") {
    const supervisorName = targets[0].supervision.supervisorName ?? "supervisor";

    return {
      targets,
      ports,
      title: `Stop ${projectName}'s managed stack?`,
      detail: `Portboard will stop the verified ${supervisorName} supervisor and every sibling command it manages.`,
      managedCommands: targets[0].supervision.managedCommands,
    };
  }

  if (targets.length <= 1) {
    return {
      targets,
      ports,
      title: `Stop all ${projectName} listeners?`,
      detail: "Portboard will stop the verified process tree.",
      managedCommands: [],
    };
  }

  const supervised = targets.filter((app) => app.supervision.kind === "supervised");

  return {
    targets,
    ports,
    title: `Stop all ${projectName} listeners?`,
    detail:
      supervised.length > 0
        ? `Portboard will stop ${targets.length} verified process trees in this folder. Each managed stack is stopped once, at its supervisor.`
        : `Portboard will stop ${targets.length} verified process trees in this folder.`,
    managedCommands: [
      ...new Set(supervised.flatMap((app) => app.supervision.managedCommands)),
    ],
  };
}

export interface GroupStopResponse {
  ok: boolean;
  json(): Promise<unknown>;
}

export type GroupStopFetch = (
  url: string,
  init: {
    method: "POST";
    headers: { "content-type": "application/json" };
    body: string;
  },
) => Promise<GroupStopResponse>;

export interface GroupStopRequestResult {
  stoppedCount: number;
  releasedPorts: number[];
  successMessages: string[];
  failureMessages: string[];
}

export async function requestGroupStop(
  targets: RunningApp[],
  fetchImpl: GroupStopFetch = fetch,
): Promise<GroupStopRequestResult> {
  const results = await Promise.all(
    targets.map(async (app) => {
      try {
        const response = await fetchImpl("/api/apps/close", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: app.id }),
        });
        const payload = await readClosePayload(response);
        const stopped = response.ok && payload.stopped === true;

        return {
          stopped,
          releasedPorts: payload.releasedPorts ?? [],
          message:
            payload.message ??
            (stopped
              ? `${app.projectName} stopped.`
              : "Windows could not stop this app."),
        };
      } catch (error) {
        return {
          stopped: false,
          releasedPorts: [] as number[],
          message:
            error instanceof Error ? error.message : "The stop request failed.",
        };
      }
    }),
  );

  const stopped = results.filter((result) => result.stopped);
  const failed = results.filter((result) => !result.stopped);

  return {
    stoppedCount: stopped.length,
    releasedPorts: [
      ...new Set(stopped.flatMap((result) => result.releasedPorts)),
    ].sort((left, right) => left - right),
    successMessages: stopped.map((result) => result.message),
    failureMessages: failed.map((result) => result.message),
  };
}

function stopTargetKey(app: RunningApp): string {
  if (app.allPorts.length === 0) {
    return `id:${app.id}`;
  }

  return `ports:${[...app.allPorts].sort((left, right) => left - right).join(",")}`;
}

function pickRepresentative(apps: RunningApp[]): RunningApp {
  return (
    apps.find((app) => app.portInfo.isPrimary) ??
    [...apps].sort((left, right) => left.port - right.port || left.pid - right.pid)[0]
  );
}

async function readClosePayload(
  response: GroupStopResponse,
): Promise<Partial<CloseAppResponse> & { message?: string }> {
  try {
    const payload = await response.json();
    if (typeof payload === "object" && payload !== null) {
      return payload as Partial<CloseAppResponse> & { message?: string };
    }
  } catch {
    return {};
  }

  return {};
}
