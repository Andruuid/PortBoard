import type { CloseAppResponse, StopWorkerResponse } from "@/lib/apps/types";

export interface StopRequestResult<T> {
  ok: boolean;
  payload: Partial<T> & { message?: string };
}

export interface StopSummary {
  succeeded: number;
  failed: number;
  releasedPorts: number[];
  firstSuccessMessage: string | null;
  firstFailureMessage: string | null;
}

async function requestStop<T extends { stopped: boolean }>(
  url: string,
  id: string,
): Promise<StopRequestResult<T>> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const payload = (await response
      .json()
      .catch(() => ({}))) as StopRequestResult<T>["payload"];

    return { ok: response.ok && payload.stopped === true, payload };
  } catch (error) {
    return {
      ok: false,
      payload: {
        message:
          error instanceof Error ? error.message : "The stop request failed.",
      } as StopRequestResult<T>["payload"],
    };
  }
}

export function requestAppStop(id: string) {
  return requestStop<CloseAppResponse>("/api/apps/close", id);
}

export function requestWorkerStop(id: string) {
  return requestStop<StopWorkerResponse>("/api/workers/stop", id);
}

export function summarizeStopResults(
  results: StopRequestResult<CloseAppResponse>[],
): StopSummary {
  const successes = results.filter((result) => result.ok);
  const failures = results.filter((result) => !result.ok);

  return {
    succeeded: successes.length,
    failed: failures.length,
    releasedPorts: [
      ...new Set(successes.flatMap(({ payload }) => payload.releasedPorts ?? [])),
    ].sort((a, b) => a - b),
    firstSuccessMessage:
      successes.find(({ payload }) => payload.message)?.payload.message ?? null,
    firstFailureMessage:
      failures.find(({ payload }) => payload.message)?.payload.message ?? null,
  };
}

export function formatFreedPorts(ports: number[]): string | undefined {
  return ports.length > 0
    ? `Freed ${ports.map((port) => `:${port}`).join(", ")}`
    : undefined;
}
