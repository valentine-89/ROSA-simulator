const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const Database = require("./dependencies.cjs")("better-sqlite3");
const {
  BackendService,
  BackendStore,
  definition,
  hash,
  authenticate,
} = require("./index.cjs");
const { DatabasePool } = require("./database.cjs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rosa-backend-test-"));
  return {
    dir,
    options: {
      statePath: path.join(dir, "state.sqlite"),
      iodataDir: path.join(dir, "iodata"),
      simulation: true,
    },
    remove() {
      assert.ok(dir.startsWith(path.join(os.tmpdir(), "rosa-backend-test-")));
      require('./test-cleanup.cjs')(dir);
    },
  };
}
const def = () =>
  definition({
    name: "test",
    source: "export default input => ({value: input.value})",
    inputSchema: {
      type: "object",
      properties: { value: { type: "integer" } },
      required: ["value"],
      additionalProperties: false,
    },
    outputSchema: { type: "object" },
    permissions: { macros: ["increment"], reports: ["report"], devices: {} },
  });
const settings = {
  timeoutSeconds: 60,
  memoryMb: 10,
  cpuPrice: 1,
  servicePrice: 0.01,
};
test("immutable publication, auth, schema, idempotency and exactly-once CPU billing", () => {
  const f = fixture(),
    store = new BackendStore(f.options);
  try {
    const d = def();
    store.save("IO123abcd", d);
    store.configure("IO123abcd", "test", {
      syncId: "SIM_SYNC",
      externalEnabled: true,
      apiKey: "test-key-012345678901234567890",
    });
    store.publish("IO123abcd", "test");
    store.save("IO123abcd", {
      ...d,
      source: "export default () => ({changed:true})",
    });
    assert.equal(store.published("IO123abcd", "test").source, d.source);
    const submit = {
      ioid: "IO123abcd",
      name: "test",
      input: { value: 1 },
      requestKey: "request-001",
      scope: "editor",
      definition: d,
      settings,
    };
    const a = store.submit(submit);
    assert.equal(store.submit(submit).runId, a.runId);
    assert.throws(() => store.submit({ ...submit, input: { value: 2 } }), {
      code: "IDEMPOTENCY_CONFLICT",
    });
    assert.throws(() => store.submit({ ...submit, input: { value: "bad" } }));
    store.claim("test");
    store.complete(a.runId, { result: { value: 1 }, cpuMs: 123 });
    store.complete(a.runId, { result: { value: 1 }, cpuMs: 123 });
    assert.equal(
      store.db.prepare("SELECT costUsed FROM sync_data").get().costUsed,
      0.123,
    );
    for (const authType of ["bearer", "api-key", "basic"]) {
      const c = {
        externalEnabled: true,
        authType,
        keyHash: hash("secret"),
        username: "demo",
      };
      const headers =
        authType === "bearer"
          ? { authorization: "Bearer secret" }
          : authType === "api-key"
            ? { "x-api-key": "secret" }
            : {
                authorization:
                  "Basic " + Buffer.from("demo:secret").toString("base64"),
              };
      assert.doesNotThrow(() => authenticate(headers, c));
      assert.throws(() => authenticate({}, c));
    }
  } finally {
    store.close();
    f.remove();
  }
});
test("SQLite concurrent writes wait, deduplicate, and roll back on deadline; report uses DuckDB", async () => {
  const f = fixture();
  fs.mkdirSync(f.options.iodataDir);
  const file = path.join(f.options.iodataDir, "IO123abcd.sqlite");
  const db = new Database(file);
  db.pragma("journal_mode=WAL");
  db.exec(
    `CREATE TABLE counter(value INTEGER);INSERT INTO counter VALUES(0);CREATE TABLE system_macros(name TEXT PRIMARY KEY,source TEXT,enabled INTEGER);`,
  );
  const macro = (n, s) =>
    db.prepare("INSERT INTO system_macros VALUES(?,?,1)").run(n, s);
  macro(
    "increment",
    "UPDATE counter SET value=value+1; SELECT value FROM counter;",
  );
  macro("report", "SELECT SUM(value)::BIGINT AS total FROM counter");
  macro("bad-report", "SELECT * FROM read_csv_auto('/etc/passwd')");
  macro("huge", "SELECT randomblob(1000000) AS value");
  macro(
    "forever",
    "UPDATE counter SET value=value+100; WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n) SELECT SUM(x) FROM n;",
  );
  const pool = new DatabasePool(4);
  try {
    db.exec("BEGIN IMMEDIATE");
    const deadline = Date.now() + 60000;
    const job = { file, name: "increment", deadline, bindings: {} };
    const pending = Promise.all(
      Array.from({ length: 1000 }, (_, i) =>
        pool.execute({ ...job, operationId: "op-" + i }),
      ),
    );
    await sleep(400);
    db.exec("COMMIT");
    const results = await pending;
    assert.equal(results.length, 1000);
    assert.equal(db.prepare("SELECT value FROM counter").get().value, 1000);
    await pool.execute({ ...job, operationId: "op-0" });
    assert.equal(db.prepare("SELECT value FROM counter").get().value, 1000);
    assert.equal(
      (
        await pool.execute({
          ...job,
          name: "report",
          report: true,
          operationId: "report",
        })
      ).rows[0].total,
      "1000",
    );
    await assert.rejects(
      pool.execute({
        ...job,
        name: "bad-report",
        report: true,
        operationId: "bad-report",
      }),
      /disabled|Permission|external/i,
    );
    await assert.rejects(
      pool.execute({
        ...job,
        name: "forever",
        deadline: Date.now() + 400,
        operationId: "forever",
      }),
    );
    await sleep(100);
    assert.equal(db.prepare("SELECT value FROM counter").get().value, 1000);
    await assert.rejects(
      pool.execute({ ...job, name: "huge", operationId: "huge" }),
      /quá lớn/i,
    );
    assert.equal(
      (await pool.execute({ ...job, operationId: "after-memory" })).rows[0]
        .value,
      1001,
    );
  } finally {
    pool.close();
    db.close();
    await sleep(200);
    f.remove();
  }
});
test("1000 concurrent submissions using the same SyncID complete with real V8 CPU", async () => {
  const f = fixture();
  const service = new BackendService({
    ...f.options,
    runner: { mode: "local", poolCount: 2, poolMemoryMb: 512 },
    sdk: async () => [],
  });
  try {
    const d = def();
    service.store.save("IO123abcd", d);
    service.store.configure("IO123abcd", "test", { syncId: "SIM_SYNC" });
    const ids = Array.from(
      { length: 1000 },
      (_, i) =>
        service.store.submit({
          ioid: "IO123abcd",
          name: "test",
          input: { value: i },
          requestKey: "parallel-" + i,
          scope: "editor",
          definition: d,
          settings,
        }).runId,
    );
    const start = Date.now();
    while (
      ids.some((id) =>
        ["running", "queued"].includes(service.store.raw(id).status),
      ) &&
      Date.now() - start < 70000
    ) {
      service.pump();
      await sleep(40);
    }
    const rows = ids.map((id) => service.store.raw(id));
    assert.equal(
      rows.filter((r) => r.status === "succeeded").length,
      1000,
      JSON.stringify(rows.filter((r) => r.status !== "succeeded").slice(0, 3)),
    );
    assert.ok(rows.reduce((n, r) => n + r.cpu_ms, 0) > 0);
    assert.ok(
      Math.abs(
        service.store.db.prepare("SELECT costUsed FROM sync_data").get()
          .costUsed - rows.reduce((n, r) => n + r.cpu_cost, 0),
      ) < 1e-7,
    );
    console.log(
      JSON.stringify({
        runs: rows.length,
        wallMs: Date.now() - start,
        cpuMs: rows.reduce((n, r) => n + r.cpu_ms, 0),
      }),
    );
  } finally {
    service.close();
    await sleep(300);
    service.store.close();
    f.remove();
  }
});
