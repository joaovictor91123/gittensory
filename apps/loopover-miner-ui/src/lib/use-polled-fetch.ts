import { useCallback, useEffect, useRef, useState } from "react";

/** Shared "live refresh" cadence for the local, offline dev-server API views (#4856) — frequent enough to feel
 *  live for a cheap local SQLite read, without polling so tightly it's wasteful. */
export const DEFAULT_POLL_INTERVAL_MS = 10_000;

export interface PolledFetch<T> {
  /** Latest fetched value, or `null` until the first fetch resolves. */
  result: T | null;
  /**
   * Imperatively fetch now, without disturbing the periodic schedule. An operator's own action can reflect
   * immediately via this trigger, while the `setInterval` keeps ticking on its original cadence — additive to
   * the timer, not a replacement for it (#7230). Coalesces with an already-in-flight fetch just like a tick does.
   */
  refresh: () => void;
}

/**
 * Fetch once on mount, then re-fetch on a fixed interval so newly-recorded local activity appears without a
 * manual page reload (#4856). Skips overlapping ticks: if a fetch from a previous tick is still in flight when
 * the next interval fires, that tick is a no-op rather than stacking concurrent requests.
 *
 * The interval is keyed on `intervalMs` alone: `loadFn` is read through a ref so a caller handing in a fresh
 * `loadFn` identity (e.g. a `useCallback` whose deps changed) neither tears down nor restarts the timer. Callers
 * that need an operator action to refresh immediately use the returned `refresh()` instead of forcing a new
 * `loadFn`, which would otherwise reset the interval's countdown (#7230).
 */
export function usePolledFetch<T>(loadFn: () => Promise<T>, intervalMs: number): PolledFetch<T> {
  const [result, setResult] = useState<T | null>(null);

  // Always read the freshest loadFn without listing it as an effect dependency, so its identity changing never
  // restarts the interval (that restart is exactly the schedule-reset bug #7230 is about). Synced in an effect
  // rather than during render, since a ref must not be written while rendering.
  const loadFnRef = useRef(loadFn);
  useEffect(() => {
    loadFnRef.current = loadFn;
  }, [loadFn]);

  // The active tick runner, published by the mount effect. Held in a ref so `refresh`'s identity stays stable
  // for every caller and invoking it never re-arms the interval.
  const runRef = useRef<() => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;

    const run = () => {
      if (inFlight) return;
      inFlight = true;
      void loadFnRef
        .current()
        .then((loaded) => {
          if (!cancelled) setResult(loaded);
        })
        .finally(() => {
          inFlight = false;
        });
    };
    runRef.current = run;

    run();
    const id = window.setInterval(run, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      runRef.current = () => {};
    };
  }, [intervalMs]);

  const refresh = useCallback(() => runRef.current(), []);

  return { result, refresh };
}
