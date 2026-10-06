"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  addPending,
  removePending,
  type PendingStops,
} from "@/lib/apps/pending-stops";

interface StopTasksContextValue {
  isStopping: (key: string) => boolean;
  track: <T>(keys: string[], task: () => Promise<T>) => Promise<T>;
}

const StopTasksContext = createContext<StopTasksContextValue | null>(null);

// Lives above the tab views so a stop keeps running (and its row keeps showing
// progress) even when the row unmounts or the user switches tabs.
export function StopTasksProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingStops>(() => new Map());

  const track = useCallback(
    async <T,>(keys: string[], task: () => Promise<T>): Promise<T> => {
      setPending((current) => addPending(current, keys));
      try {
        return await task();
      } finally {
        setPending((current) => removePending(current, keys));
      }
    },
    [],
  );

  const value = useMemo<StopTasksContextValue>(
    () => ({ isStopping: (key) => pending.has(key), track }),
    [pending, track],
  );

  return (
    <StopTasksContext.Provider value={value}>{children}</StopTasksContext.Provider>
  );
}

export function useStopTasks(): StopTasksContextValue {
  const context = useContext(StopTasksContext);
  if (!context) {
    throw new Error("useStopTasks must be used inside a StopTasksProvider.");
  }
  return context;
}
