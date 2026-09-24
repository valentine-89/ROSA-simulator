const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  { execFileSync } = require("node:child_process");
const Database = require("./dependencies.cjs")("better-sqlite3");
const { DatabasePool } = require("./database.cjs");
async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rosa-db-container-")),
    file = path.join(dir, "IOtest.sqlite"),
    db = new Database(file);
  db.pragma("journal_mode=WAL");
  db.exec(
    "CREATE TABLE counter(n INTEGER);INSERT INTO counter VALUES(0);CREATE TABLE system_macros(name TEXT PRIMARY KEY,source TEXT,enabled INTEGER)",
  );
  const add = (n, s) =>
    db.prepare("INSERT INTO system_macros VALUES(?,?,1)").run(n, s);
  add("increment", "UPDATE counter SET n=n+1; SELECT n FROM counter");
  add("huge", "SELECT length(randomblob(900000000)) AS bytes");
  add("report", "SELECT SUM(n)::BIGINT AS total FROM counter");
  add(
    "loop",
    "UPDATE counter SET n=n+100; WITH RECURSIVE x(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM x) SELECT SUM(n) FROM x",
  );
  const pool = new DatabasePool({ size: 2, mode: "docker", iodataDir: dir });
  try {
    const job = {
      file,
      name: "increment",
      bindings: {},
      deadline: Date.now() + 60000,
    };
    db.exec("BEGIN IMMEDIATE");
    const pending = Promise.all(
      Array.from({ length: 1000 }, (_, i) =>
        pool.execute({ ...job, operationId: "parallel-" + i }),
      ),
    );
    await new Promise((r) => setTimeout(r, 1000));
    db.exec("COMMIT");
    await pending;
    assert.equal(db.prepare("SELECT n FROM counter").get().n, 1000);
    for (const slot of pool.workers) {
      const c = JSON.parse(
        execFileSync("docker", ["inspect", slot.containerName], {
          encoding: "utf8",
        }),
      )[0];
      assert.equal(c.HostConfig.Memory, 268435456);
      assert.equal(c.HostConfig.NetworkMode, "none");
      assert.equal(c.HostConfig.ReadonlyRootfs, true);
      assert.equal(c.Mounts.length, 1);
      assert.equal(c.Mounts[0].Source, dir);
    }
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
        name: "loop",
        operationId: "loop",
        deadline: Date.now() + 500,
      }),
    );
    assert.equal(db.prepare("SELECT n FROM counter").get().n, 1000);
    await assert.rejects(
      pool.execute({ ...job, name: "huge", operationId: "huge" }),
    );
    await pool.execute({ ...job, operationId: "after-oom" });
    assert.equal(db.prepare("SELECT n FROM counter").get().n, 1001);
    console.log(
      "Database Docker passed: 1000 writes wait, DuckDB report, timeout rollback, native OOM bounded at 256 MiB and recovery.",
    );
  } finally {
    const names = pool.workers.map((s) => s.containerName);
    pool.close();
    db.close();
    for (const name of names)
      for (let i = 0; i < 100; i++) {
        if (
          !execFileSync("docker", ["ps", "-q", "--filter", "name=" + name], {
            encoding: "utf8",
          }).trim()
        )
          break;
        await new Promise((r) => setTimeout(r, 100));
      }
    assert.ok(dir.startsWith(path.join(os.tmpdir(), "rosa-db-container-")));
    require('./test-cleanup.cjs')(dir);
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
