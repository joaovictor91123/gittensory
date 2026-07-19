import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_POLL_INTERVAL_MS, usePolledFetch } from "./lib/use-polled-fetch";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("usePolledFetch (#4856)", () => {
  it("fetches once immediately on mount", async () => {
    const loadFn = vi.fn(async () => "loaded");
    const { result } = renderHook(() => usePolledFetch(loadFn, 1000));
    await waitFor(() => expect(result.current.result).toBe("loaded"));
    expect(loadFn).toHaveBeenCalledTimes(1);
  });

  it("re-fetches on every poll interval tick, updating the returned result each time", async () => {
    vi.useFakeTimers();
    let call = 0;
    const loadFn = vi.fn(async () => `loaded-${(call += 1)}`);
    const { result } = renderHook(() => usePolledFetch(loadFn, 1000));

    await vi.waitFor(() => expect(result.current.result).toBe("loaded-1"));

    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(result.current.result).toBe("loaded-2"));

    await vi.advanceTimersByTimeAsync(1000);
    await vi.waitFor(() => expect(result.current.result).toBe("loaded-3"));

    expect(loadFn).toHaveBeenCalledTimes(3);
  });

  it("stops polling after unmount", async () => {
    vi.useFakeTimers();
    const loadFn = vi.fn(async () => "loaded");
    const { result, unmount } = renderHook(() => usePolledFetch(loadFn, 1000));
    await vi.waitFor(() => expect(result.current.result).toBe("loaded"));
    expect(loadFn).toHaveBeenCalledTimes(1);

    unmount();
    await vi.advanceTimersByTimeAsync(5000);
    expect(loadFn).toHaveBeenCalledTimes(1); // no further calls after unmount
  });

  it("skips an overlapping tick when the previous fetch is still in flight, instead of stacking concurrent requests", async () => {
    vi.useFakeTimers();
    let resolveFirst: ((value: string) => void) | undefined;
    let callCount = 0;
    const loadFn = vi.fn(() => {
      callCount += 1;
      if (callCount === 1) {
        return new Promise<string>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve(`loaded-${callCount}`);
    });

    renderHook(() => usePolledFetch(loadFn, 1000));
    expect(loadFn).toHaveBeenCalledTimes(1); // first call in flight, unresolved

    // A tick fires while the first fetch is still pending -- must be skipped, not stacked.
    await vi.advanceTimersByTimeAsync(1000);
    expect(loadFn).toHaveBeenCalledTimes(1);

    // Resolve the first fetch; the NEXT tick after that is free to fetch again.
    resolveFirst?.("loaded-1");
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(loadFn).toHaveBeenCalledTimes(2);
  });

  it("does not update the result after unmount, even if an in-flight fetch resolves late", async () => {
    let resolveLoad: ((value: string) => void) | undefined;
    const loadFn = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    const { result, unmount } = renderHook(() => usePolledFetch(loadFn, 1000));
    unmount();
    resolveLoad?.("too-late");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current.result).toBeNull();
  });

  it("exports a sensible default poll interval", () => {
    expect(DEFAULT_POLL_INTERVAL_MS).toBeGreaterThan(0);
  });

  // #7230: a caller handing in a fresh loadFn identity (e.g. a useCallback whose deps changed) must NOT tear down
  // and restart the interval -- doing so resets the periodic countdown, which is the schedule-reset bug.
  it("does not restart the interval when the loadFn identity changes between renders (#7230)", async () => {
    vi.useFakeTimers();
    // Each render gets a brand-new loadFn closure, but the periodic schedule must stay on its original cadence.
    let ticks = 0;
    const makeLoadFn = () => vi.fn(async () => `tick-${(ticks += 1)}`);
    const { result, rerender } = renderHook(({ loadFn }) => usePolledFetch(loadFn, 1000), {
      initialProps: { loadFn: makeLoadFn() },
    });
    await vi.waitFor(() => expect(result.current.result).toBe("tick-1"));

    // Part-way through the interval, re-render with a new loadFn identity -- the schedule must be undisturbed.
    await vi.advanceTimersByTimeAsync(600);
    rerender({ loadFn: makeLoadFn() });
    // No immediate fetch fired from the identity change, and no restart: still 1 fetch so far.
    expect(ticks).toBe(1);

    // The ORIGINAL schedule's next tick lands 1000ms after mount (i.e. 400ms more), not 1000ms after the rerender.
    // The tick fetches once (ticks -> 2) using the freshest loadFn read through the ref.
    await vi.advanceTimersByTimeAsync(400);
    await vi.waitFor(() => expect(result.current.result).toBe("tick-2"));
    expect(ticks).toBe(2);
  });

  // #7230: refresh() imperatively fetches now, additive to the timer -- it neither resets the countdown nor is a
  // no-op; the very next scheduled tick still lands on the ORIGINAL cadence.
  it("refresh() fetches immediately without resetting the interval schedule (#7230)", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const loadFn = vi.fn(async () => `load-${(calls += 1)}`);
    const { result } = renderHook(() => usePolledFetch(loadFn, 1000));
    await vi.waitFor(() => expect(calls).toBe(1)); // mount fetch

    // Fire an imperative refresh mid-interval (at t=500ms) -- the immediate extra fetch happens right away.
    await vi.advanceTimersByTimeAsync(500);
    result.current.refresh();
    await vi.waitFor(() => expect(result.current.result).toBe("load-2"));
    expect(calls).toBe(2);

    // The periodic tick still fires at the ORIGINAL t=1000ms (500ms after the refresh), not 1000ms after it.
    await vi.advanceTimersByTimeAsync(500);
    await vi.waitFor(() => expect(result.current.result).toBe("load-3"));
    expect(calls).toBe(3);
  });
});
