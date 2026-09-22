import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { RunningAppsView } from "@/components/running-apps-view";
import {
  planGroupStop,
  requestGroupStop,
  selectGroupStopTargets,
  type GroupStopFetch,
} from "@/lib/apps/group-stop";
import type { AppSupervision, RunningApp } from "@/lib/apps/types";

function app(
  id: string,
  port: number,
  allPorts: number[],
  supervision: AppSupervision,
  options: { isPrimary?: boolean; projectName?: string } = {},
): RunningApp {
  return {
    id,
    port,
    url: `http://localhost:${port}`,
    pid: port,
    projectName: options.projectName ?? "Delibora",
    projectRoot: "C:\\Codex\\Delibora-feature",
    gitBranch: "feature",
    runtime: "next",
    confidence: "identified",
    allPorts,
    startedAt: null,
    listeningAddress: "127.0.0.1",
    portInfo: {
      kind: options.isPrimary === false ? "service" : "primary-web",
      label: options.isPrimary === false ? "Service" : "Primary app",
      description: "Listener.",
      isPrimary: options.isPrimary !== false,
      canOpen: options.isPrimary !== false,
    },
    supervision,
  };
}

const concurrently: AppSupervision = {
  kind: "supervised",
  supervisorName: "concurrently",
  managedCommands: ["web", "worker"],
  restartLikely: true,
};

const direct: AppSupervision = {
  kind: "direct",
  supervisorName: null,
  managedCommands: [],
  restartLikely: false,
};

function jsonResponse(
  body: unknown,
  ok = true,
): Awaited<ReturnType<GroupStopFetch>> {
  return {
    ok,
    json: async () => body,
  };
}

describe("selectGroupStopTargets", () => {
  test("collapses listeners that share a supervisor port set into one stop", () => {
    const targets = selectGroupStopTargets([
      app("web", 3003, [52142, 3003], concurrently),
      app("worker", 52142, [3003, 52142], concurrently, { isPrimary: false }),
    ]);

    expect(targets.map((target) => target.id)).toEqual(["web"]);
  });

  test("prefers the primary listener when siblings share a supervisor", () => {
    const targets = selectGroupStopTargets([
      app("worker", 52142, [3003, 52142], concurrently, { isPrimary: false }),
      app("web", 3003, [3003, 52142], concurrently),
    ]);

    expect(targets.map((target) => target.id)).toEqual(["web"]);
  });

  test("keeps independent listeners in the same folder as separate stops", () => {
    const targets = selectGroupStopTargets([
      app("one", 3000, [3000], direct),
      app("two", 4000, [4000], direct, { isPrimary: false }),
    ]);

    expect(targets.map((target) => target.id)).toEqual(["one", "two"]);
  });

  test("stops a shared stack once and other trees separately", () => {
    const targets = selectGroupStopTargets([
      app("web", 3003, [3003, 52142], concurrently),
      app("worker", 52142, [3003, 52142], concurrently, { isPrimary: false }),
      app("extra", 8080, [8080], direct, { isPrimary: false }),
    ]);

    expect(targets.map((target) => target.id)).toEqual(["web", "extra"]);
  });

  test("does not merge listeners that have no shared port set", () => {
    const targets = selectGroupStopTargets([
      app("one", 3000, [], direct),
      app("two", 4000, [], direct, { isPrimary: false }),
    ]);

    expect(targets.map((target) => target.id)).toEqual(["one", "two"]);
  });
});

describe("planGroupStop", () => {
  test("describes one supervisor stop the same way as Stop stack", () => {
    const plan = planGroupStop(
      [
        app("web", 3003, [3003, 52142], concurrently),
        app("worker", 52142, [3003, 52142], concurrently, { isPrimary: false }),
      ],
      "Delibora",
    );

    expect(plan.targets).toHaveLength(1);
    expect(plan.title).toBe("Stop Delibora's managed stack?");
    expect(plan.detail).toContain("verified concurrently supervisor");
    expect(plan.managedCommands).toEqual(["web", "worker"]);
    expect(plan.ports).toEqual([3003, 52142]);
  });

  test("describes separate process trees when the folder has more than one stop target", () => {
    const plan = planGroupStop(
      [
        app("one", 3000, [3000], direct, { projectName: "Alpha" }),
        app("two", 4000, [4000], concurrently, {
          isPrimary: false,
          projectName: "Alpha",
        }),
      ],
      "Alpha",
    );

    expect(plan.targets).toHaveLength(2);
    expect(plan.title).toBe("Stop all Alpha listeners?");
    expect(plan.detail).toContain("2 verified process trees");
    expect(plan.detail).toContain("stopped once, at its supervisor");
  });
});

describe("requestGroupStop", () => {
  test("calls close once for a shared stack", async () => {
    const calls: string[] = [];
    const targets = selectGroupStopTargets([
      app("web", 3003, [3003, 52142], concurrently),
      app("worker", 52142, [3003, 52142], concurrently, { isPrimary: false }),
    ]);

    const result = await requestGroupStop(targets, async (_url, init) => {
      calls.push(JSON.parse(init.body).id as string);
      return jsonResponse({
        stopped: true,
        releasedPorts: [3003, 52142],
        message: "Delibora's managed development stack stopped successfully.",
      });
    });

    expect(calls).toEqual(["web"]);
    expect(result.stoppedCount).toBe(1);
    expect(result.releasedPorts).toEqual([3003, 52142]);
    expect(result.failureMessages).toEqual([]);
  });

  test("stops distinct targets in parallel", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const ids: string[] = [];
    const targets = selectGroupStopTargets([
      app("one", 3000, [3000], direct),
      app("two", 4000, [4000], direct, { isPrimary: false }),
    ]);

    await requestGroupStop(targets, async (_url, init) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      ids.push(JSON.parse(init.body).id as string);
      await new Promise((resolve) => setTimeout(resolve, 30));
      inFlight -= 1;
      return jsonResponse({
        stopped: true,
        releasedPorts: [JSON.parse(init.body).id === "one" ? 3000 : 4000],
        message: "stopped",
      });
    });

    expect(ids.sort()).toEqual(["one", "two"]);
    expect(maxInFlight).toBe(2);
  });

  test("reports a failed close without dropping a successful sibling", async () => {
    const targets = selectGroupStopTargets([
      app("one", 3000, [3000], direct),
      app("two", 4000, [4000], direct, { isPrimary: false }),
    ]);

    const result = await requestGroupStop(targets, async (_url, init) => {
      const id = JSON.parse(init.body).id as string;
      if (id === "two") {
        return jsonResponse({ stopped: false, message: "Access is denied." }, false);
      }

      return jsonResponse({
        stopped: true,
        releasedPorts: [3000],
        message: "Alpha stopped successfully.",
      });
    });

    expect(result.stoppedCount).toBe(1);
    expect(result.releasedPorts).toEqual([3000]);
    expect(result.failureMessages).toEqual(["Access is denied."]);
  });
});

describe("RunningAppsView group actions", () => {
  test("shows Stop all on a collapsed parent and keeps child actions unmounted", () => {
    const html = renderToStaticMarkup(
      <RunningAppsView
        apps={[
          app("web", 3003, [3003, 52142], concurrently),
          app("worker", 52142, [3003, 52142], concurrently, { isPrimary: false }),
        ]}
        onStopped={() => undefined}
      />,
    );

    expect(html).toContain("Stop all");
    expect(html).toContain("Stop all 2 Delibora listeners");
    expect(html).toContain("Expand Delibora (2 ports)");
    expect(html).not.toContain("Expanded");
    expect(html).not.toContain("Collapsed");
    expect(html).not.toContain("Stop stack");
  });

  test("leaves a single listener on its own Stop stack action", () => {
    const html = renderToStaticMarkup(
      <RunningAppsView
        apps={[app("web", 3003, [3003, 52142], concurrently)]}
        onStopped={() => undefined}
      />,
    );

    expect(html).toContain("Stop stack");
    expect(html).not.toContain("Stop all");
  });
});
