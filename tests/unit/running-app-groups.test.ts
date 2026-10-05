import { describe, expect, test } from "vitest";

import { groupRunningApps } from "@/components/running-apps-view";
import {
  collectGroupPorts,
  selectGroupStopTargets,
} from "@/lib/apps/group-stop";
import type { RunningApp } from "@/lib/apps/types";

function app(
  id: string,
  port: number,
  projectRoot: string | null,
  projectName = "example",
  overrides: Partial<RunningApp> = {},
): RunningApp {
  return {
    id,
    port,
    url: `http://localhost:${port}`,
    pid: port,
    projectName,
    projectRoot,
    gitBranch: "main",
    runtime: "next",
    confidence: projectRoot ? "identified" : "unidentified",
    allPorts: [port],
    startedAt: null,
    listeningAddress: "127.0.0.1",
    portInfo: {
      kind: "primary-web",
      label: "Primary app",
      description: "Main web app.",
      isPrimary: true,
      canOpen: true,
    },
    supervision: {
      kind: "direct",
      supervisorName: null,
      managedCommands: [],
      restartLikely: false,
    },
    ...overrides,
  };
}

describe("groupRunningApps", () => {
  test("groups apps from the same normalized project folder", () => {
    const groups = groupRunningApps([
      app("one", 1025, "C:\\Code\\Project"),
      app("two", 3000, "c:/code/project/"),
      app("three", 4000, "C:\\Code\\Other"),
    ]);

    expect(groups).toHaveLength(2);
    expect(
      groups.find((group) => group.apps.length === 2)?.apps.map((item) => item.port),
    ).toEqual([1025, 3000]);
  });

  test("keeps apps without a discovered folder separate", () => {
    const groups = groupRunningApps([
      app("one", 1025, null),
      app("two", 3000, null),
    ]);

    expect(groups).toHaveLength(2);
  });

  test("sorts groups by project name and grouped listeners by port", () => {
    const groups = groupRunningApps([
      app("z-two", 4000, "C:\\Code\\Zulu", "Zulu"),
      app("alpha-high", 3100, "C:\\Code\\Alpha", "alpha"),
      app("alpha-low", 1200, "C:\\Code\\Alpha", "alpha"),
      app("beta", 2000, "C:\\Code\\Beta", "Beta"),
    ]);

    expect(groups.map((group) => group.apps[0].projectName)).toEqual([
      "alpha",
      "Beta",
      "Zulu",
    ]);
    expect(groups[0].apps.map((item) => item.port)).toEqual([1200, 3100]);
  });
});

describe("selectGroupStopTargets", () => {
  test("returns a single supervised primary when the stack shares a supervisor", () => {
    const web = app("web", 3000, "C:\\Code\\Delibora", "Delibora", {
      allPorts: [3000, 4100],
      portInfo: {
        kind: "primary-web",
        label: "Primary app",
        description: "Main web app.",
        isPrimary: true,
        canOpen: true,
      },
      supervision: {
        kind: "supervised",
        supervisorName: "concurrently",
        managedCommands: ["web", "worker"],
        restartLikely: true,
      },
    });
    const worker = app("worker", 4100, "C:\\Code\\Delibora", "Delibora", {
      allPorts: [3000, 4100],
      portInfo: {
        kind: "service",
        label: "Worker",
        description: "Background worker.",
        isPrimary: false,
        canOpen: false,
      },
      supervision: {
        kind: "supervised",
        supervisorName: "concurrently",
        managedCommands: ["web", "worker"],
        restartLikely: true,
      },
    });

    expect(selectGroupStopTargets([worker, web]).map((item) => item.id)).toEqual([
      "web",
    ]);
  });

  test("falls back to the first supervised app when none is primary", () => {
    const first = app("a", 3000, "C:\\Code\\Stack", "Stack", {
      portInfo: {
        kind: "web",
        label: "Web",
        description: "Web.",
        isPrimary: false,
        canOpen: true,
      },
      supervision: {
        kind: "supervised",
        supervisorName: "concurrently",
        managedCommands: ["a", "b"],
        restartLikely: true,
      },
    });
    const second = app("b", 4100, "C:\\Code\\Stack", "Stack", {
      portInfo: {
        kind: "service",
        label: "Service",
        description: "Service.",
        isPrimary: false,
        canOpen: false,
      },
      supervision: {
        kind: "supervised",
        supervisorName: "concurrently",
        managedCommands: ["a", "b"],
        restartLikely: true,
      },
    });

    expect(selectGroupStopTargets([first, second]).map((item) => item.id)).toEqual([
      "a",
    ]);
  });

  test("returns every direct listener for parallel independent stops", () => {
    const apps = [
      app("one", 1025, "C:\\Code\\Project"),
      app("two", 3000, "C:\\Code\\Project"),
    ];

    expect(selectGroupStopTargets(apps).map((item) => item.id)).toEqual([
      "one",
      "two",
    ]);
  });
});

describe("collectGroupPorts", () => {
  test("unions and sorts allPorts across the group", () => {
    expect(
      collectGroupPorts([
        app("one", 3000, "C:\\Code\\Project", "Project", {
          allPorts: [3000, 4100],
        }),
        app("two", 4100, "C:\\Code\\Project", "Project", {
          allPorts: [3000, 4100],
        }),
      ]),
    ).toEqual([3000, 4100]);
  });
});
