import { afterEach, describe, expect, test, vi } from "vitest";

import {
  addPending,
  appStopKey,
  removePending,
  workerStopKey,
} from "@/lib/apps/pending-stops";
import {
  formatFreedPorts,
  requestAppStop,
  requestWorkerStop,
  summarizeStopResults,
} from "@/lib/apps/stop-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("requestAppStop", () => {
  test("posts the id and reports a verified stop", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, { stopped: true, releasedPorts: [3000], message: "Stopped." }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestAppStop("app-123");

    expect(fetchMock).toHaveBeenCalledWith("/api/apps/close", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "app-123" }),
    });
    expect(result).toEqual({
      ok: true,
      payload: { stopped: true, releasedPorts: [3000], message: "Stopped." },
    });
  });

  test("treats an error status as a failure without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(409, { message: "No longer running." })),
    );

    await expect(requestAppStop("app-123")).resolves.toEqual({
      ok: false,
      payload: { message: "No longer running." },
    });
  });

  test("treats a 200 without stopped=true as a failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { stopped: false })));

    expect((await requestAppStop("app-123")).ok).toBe(false);
  });

  test("maps network errors and non-JSON bodies to a failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await expect(requestAppStop("app-123")).resolves.toEqual({
      ok: false,
      payload: { message: "Failed to fetch" },
    });

    vi.stubGlobal("fetch", vi.fn(async () => new Response("oops", { status: 500 })));
    await expect(requestAppStop("app-123")).resolves.toEqual({
      ok: false,
      payload: {},
    });
  });
});

describe("requestWorkerStop", () => {
  test("posts to the worker endpoint", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { stopped: true }));
    vi.stubGlobal("fetch", fetchMock);

    expect((await requestWorkerStop("worker-1")).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/workers/stop",
      expect.objectContaining({ body: JSON.stringify({ id: "worker-1" }) }),
    );
  });
});

describe("summarizeStopResults", () => {
  test("merges, dedupes and sorts released ports when all stops succeed", () => {
    expect(
      summarizeStopResults([
        { ok: true, payload: { releasedPorts: [5173, 3000] } },
        { ok: true, payload: { releasedPorts: [3000], message: "Done." } },
      ]),
    ).toEqual({
      succeeded: 2,
      failed: 0,
      releasedPorts: [3000, 5173],
      firstSuccessMessage: "Done.",
      firstFailureMessage: null,
    });
  });

  test("keeps freed ports from successes when some stops fail", () => {
    expect(
      summarizeStopResults([
        { ok: true, payload: { releasedPorts: [4000] } },
        { ok: false, payload: { releasedPorts: [9999], message: "Access denied." } },
      ]),
    ).toEqual({
      succeeded: 1,
      failed: 1,
      releasedPorts: [4000],
      firstSuccessMessage: null,
      firstFailureMessage: "Access denied.",
    });
  });

  test("reports all failures", () => {
    const summary = summarizeStopResults([
      { ok: false, payload: {} },
      { ok: false, payload: { message: "Still owns its port." } },
    ]);

    expect(summary.succeeded).toBe(0);
    expect(summary.failed).toBe(2);
    expect(summary.releasedPorts).toEqual([]);
    expect(summary.firstFailureMessage).toBe("Still owns its port.");
  });
});

describe("formatFreedPorts", () => {
  test("formats ports and omits an empty list", () => {
    expect(formatFreedPorts([3000, 4100])).toBe("Freed :3000, :4100");
    expect(formatFreedPorts([])).toBeUndefined();
  });
});

describe("pending stop refcounts", () => {
  test("keeps a key pending until every overlapping stop settles", () => {
    const a = appStopKey("a");
    const b = workerStopKey("b");

    let pending = addPending(new Map(), [a, b]);
    pending = addPending(pending, [a]);
    expect(pending.get(a)).toBe(2);

    pending = removePending(pending, [a, b]);
    expect(pending.has(a)).toBe(true);
    expect(pending.has(b)).toBe(false);

    pending = removePending(pending, [a]);
    expect(pending.size).toBe(0);
  });

  test("does not mutate the previous map", () => {
    const before = new Map([["app:a", 1]]);
    const after = removePending(before, ["app:a"]);

    expect(before.get("app:a")).toBe(1);
    expect(after.has("app:a")).toBe(false);
  });
});
