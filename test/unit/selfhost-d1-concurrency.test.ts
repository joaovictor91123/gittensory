import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createD1Adapter, nodeSqliteDriver } from "../../src/selfhost/d1-adapter";

// Concurrency-model verification for the shared SQLite backend (#4942). The AMS local-store guarantees were
// originally designed for two local processes sharing one SQLite file; #7175 migrated that layer onto the
// shared SelfHostD1Database seam (src/selfhost/backend-contracts.ts, #4010), so the guarantees the hosted
// service now actually relies on need to be verified against the real seam and documented, not assumed to
// still hold implicitly. This file pins down the SQLite side's guarantees under concurrent access from the
// async D1 surface -- the model the SQLite backend actually has: a single process, a synchronous driver,
// operations serialized on the event loop, never real OS-level multi-connection contention (see
// src/selfhost/backend-concurrency-model.md). The Postgres side's real cross-connection concurrency is
// exercised by the PG_TEST_URL-gated test/integration/selfhost-pg.test.ts, since it needs a live server.

function makeDb(): { d1: D1Database; raw: DatabaseSync } {
  // The production open path (src/server.ts:266) sets these exact PRAGMAs; matching them here keeps the seam
  // under test aligned with the deployed configuration. An in-memory db is a single connection -- the SQLite
  // backend's real topology (single process, one file/connection) -- so "concurrency" here is event-loop
  // interleaving of the async D1 surface, not OS-level multi-connection contention.
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  return { d1: createD1Adapter(nodeSqliteDriver(raw as never)), raw };
}

async function readCounter(d1: D1Database): Promise<number> {
  return (await d1.prepare("SELECT value FROM counters WHERE id = 'c'").first<number>("value")) ?? -1;
}

let d1: D1Database;
let raw: DatabaseSync;

beforeEach(async () => {
  ({ d1, raw } = makeDb());
  await d1.exec("CREATE TABLE counters (id TEXT PRIMARY KEY, value INTEGER NOT NULL);");
  await d1.prepare("INSERT INTO counters (id, value) VALUES ('c', 0)").run();
});

afterEach(() => {
  raw.close(); // release the SQLite handle so nothing is left open between tests
});

describe("shared SQLite backend concurrency guarantees (#4942)", () => {
  it("GUARANTEE: N concurrent atomic increments lose no updates (final value == N)", async () => {
    const N = 50;
    // A single self-contained UPDATE is a single statement on the synchronous driver -- it runs to completion
    // before the next call resumes, so every increment is applied; none can interleave mid-statement.
    await Promise.all(
      Array.from({ length: N }, () => d1.prepare("UPDATE counters SET value = value + 1 WHERE id = 'c'").run()),
    );
    expect(await readCounter(d1)).toBe(N);
  });

  it("BOUNDARY: concurrent non-atomic read-modify-write loses updates -- the documented hazard, not a bug", async () => {
    const N = 50;
    // Splitting the increment into an awaited read then an awaited write lets every one of the N sequences
    // observe the same pre-write value before any write lands, so all but one update is lost. This is
    // deterministic here (every read resolves before the first write, since the read is issued synchronously
    // at the top of each async callback) -- the exact reason callers must use a single atomic statement or a
    // batch(), never a bare read-then-write pair, on ANY backend.
    await Promise.all(
      Array.from({ length: N }, async () => {
        const current = await readCounter(d1);
        await d1.prepare("UPDATE counters SET value = ? WHERE id = 'c'").bind(current + 1).run();
      }),
    );
    const final = await readCounter(d1);
    expect(final).toBeLessThan(N);
    expect(final).toBe(1);
  });

  it("GUARANTEE: a failing statement rolls back the whole batch (no partial write)", async () => {
    // The second statement violates the PRIMARY KEY, so the whole batch must ROLLBACK, leaving the first
    // statement's UPDATE un-applied too.
    await expect(
      d1.batch([
        d1.prepare("UPDATE counters SET value = 99 WHERE id = 'c'"),
        d1.prepare("INSERT INTO counters (id, value) VALUES ('c', 1)"), // duplicate PK -> throws
      ]),
    ).rejects.toThrow();
    expect(await readCounter(d1)).toBe(0);
  });

  it("GUARANTEE: a committed batch applies every statement, in order", async () => {
    await d1.batch([
      d1.prepare("UPDATE counters SET value = value + 10 WHERE id = 'c'"),
      d1.prepare("UPDATE counters SET value = value * 2 WHERE id = 'c'"),
    ]);
    expect(await readCounter(d1)).toBe(20); // (0 + 10) * 2, in the order given
  });

  it("GUARANTEE: a read concurrent with a batch never observes a rolled-back intermediate state", async () => {
    // The batch runs BEGIN..COMMIT/ROLLBACK synchronously with no await in between (the driver is sync), so an
    // interleaved read can only ever see the pre-batch or post-batch value, never a partially-applied one.
    const failing = d1
      .batch([
        d1.prepare("UPDATE counters SET value = 77 WHERE id = 'c'"),
        d1.prepare("INSERT INTO counters (id, value) VALUES ('c', 2)"), // duplicate PK -> rollback
      ])
      .catch(() => "rolled-back" as const);
    const observedDuring = await readCounter(d1);
    await failing;
    expect(observedDuring).toBe(0); // never the uncommitted 77
    expect(await readCounter(d1)).toBe(0); // rolled back cleanly
  });
});
