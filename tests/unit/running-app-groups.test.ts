import { describe, expect, test } from "vitest";

import { groupRunningApps } from "@/components/running-apps-view";
import type { RunningApp } from "@/lib/apps/types";

function app(
  id: string,
  port: number,
  projectRoot: string | null,
  projectName = "example",
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
