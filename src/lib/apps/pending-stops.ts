export type PendingStops = ReadonlyMap<string, number>;

export const appStopKey = (id: string) => `app:${id}`;
export const workerStopKey = (id: string) => `worker:${id}`;

export function addPending(pending: PendingStops, keys: string[]): PendingStops {
  const next = new Map(pending);
  for (const key of keys) {
    next.set(key, (next.get(key) ?? 0) + 1);
  }
  return next;
}

export function removePending(
  pending: PendingStops,
  keys: string[],
): PendingStops {
  const next = new Map(pending);
  for (const key of keys) {
    const count = (next.get(key) ?? 0) - 1;
    if (count > 0) {
      next.set(key, count);
    } else {
      next.delete(key);
    }
  }
  return next;
}
