"use strict";
const Database = require("./dependencies.cjs")("better-sqlite3");
function statements(source) {
  const result = [];
  let text = "",
    quote = "",
    line = false,
    block = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i],
      n = source[i + 1];
    if (line) {
      if (c === "\n") {
        line = false;
        text += " ";
      }
      continue;
    }
    if (block) {
      if (c === "*" && n === "/") {
        block = false;
        i++;
        text += " ";
      }
      continue;
    }
    if (quote) {
      text += c;
      if (c === quote) {
        if (n === quote) {
          text += n;
          i++;
        } else quote = "";
      }
      continue;
    }
    if (c === "-" && n === "-") {
      line = true;
      i++;
      continue;
    }
    if (c === "/" && n === "*") {
      block = true;
      i++;
      continue;
    }
    if (['"', "'", "`"].includes(c)) {
      quote = c;
      text += c;
      continue;
    }
    if (c === ";") {
      if (text.trim()) result.push(text.trim());
      text = "";
    } else text += c;
  }
  if (text.trim()) result.push(text.trim());
  return result;
}
function parameters(sql, values) {
  let output = "",
    quote = "";
  const args = [];
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i],
      n = sql[i + 1];
    if (quote) {
      output += c;
      if (c === quote) {
        if (n === quote) {
          output += n;
          i++;
        } else quote = "";
      }
      continue;
    }
    if (['"', "'", "`"].includes(c)) {
      quote = c;
      output += c;
      continue;
    }
    const match =
      c === ":" && sql[i - 1] !== ":" && n !== ":"
        ? /^:([A-Za-z_][A-Za-z0-9_]*)/.exec(sql.slice(i))
        : null;
    if (match) {
      const value = values[match[1]];
      args.push(
        value == null
          ? null
          : typeof value === "object"
            ? JSON.stringify(value)
            : String(value),
      );
      output += "?";
      i += match[0].length - 1;
    } else output += c;
  }
  return { sql: output, args };
}
async function execute(job) {
  if (Date.now() >= job.deadline)
    throw Object.assign(new Error("Hết thời gian chờ database."), {
      code: "RUN_TIMEOUT",
    });
  const db = new Database(job.file, {
    fileMustExist: true,
    timeout: Math.max(1, job.deadline - Date.now()),
  });
  try {
    db.pragma("busy_timeout=" + Math.max(1, job.deadline - Date.now()));
    db.pragma("hard_heap_limit=67108864");
    db.pragma("temp_store=MEMORY");
    db.pragma("cache_size=-16384");
    if (job.report) return await report(db, job);
    const tx = db.transaction(() => {
      if (Date.now() >= job.deadline)
        throw Object.assign(new Error("Hết thời gian chờ database."), {
          code: "RUN_TIMEOUT",
        });
      db.exec(
        "CREATE TABLE IF NOT EXISTS system_backend_operations(id TEXT PRIMARY KEY,result TEXT NOT NULL,created INTEGER NOT NULL)",
      );
      db.exec(
        "CREATE INDEX IF NOT EXISTS system_backend_operations_created ON system_backend_operations(created)",
      );
      db.prepare(
        "DELETE FROM system_backend_operations WHERE id IN (SELECT id FROM system_backend_operations WHERE created<? ORDER BY created LIMIT 100)",
      ).run(Date.now() - 7 * 86400000);
      const prior = db
        .prepare("SELECT result FROM system_backend_operations WHERE id=?")
        .get(job.operationId);
      if (prior) return JSON.parse(prior.result);
      const macro = db
        .prepare("SELECT source,enabled FROM system_macros WHERE name=?")
        .get(job.name);
      if (!macro || !macro.enabled)
        throw new Error("Macro không tồn tại hoặc đã tắt.");
      if (
        db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE name='system_service_macros'",
          )
          .get() &&
        db
          .prepare("SELECT 1 FROM system_service_macros WHERE name=?")
          .get(job.name)
      )
        throw new Error("Macro chỉ dành cho callback dịch vụ.");
      const sqls = statements(macro.source);
      let rows = [],
        changed = false;
      for (const sql of sqls) {
        // Macros may access the current IoData file only, never attach host files/extensions.
        if (
          !/^(SELECT|WITH|INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP)\b/i.test(
            sql,
          ) ||
          /\b(load_extension|readfile|writefile|ATTACH|DETACH|VACUUM|PRAGMA|system_backend_operations)\b/i.test(
            sql,
          )
        )
          throw new Error("Macro dùng thao tác không được phép trong Backend.");
        if (Date.now() >= job.deadline)
          throw Object.assign(new Error("Backend đã hết thời gian."), {
            code: "RUN_TIMEOUT",
          });
        const p = parameters(sql, job.bindings);
        const statement = db.prepare(p.sql);
        if (statement.reader) {
          changed = changed || !statement.readonly;
          rows = [];
          let bytes = 0;
          for (const row of statement.iterate(p.args)) {
            bytes += Buffer.byteLength(
              JSON.stringify(row, (_, v) =>
                typeof v === "bigint" ? String(v) : v,
              ),
            );
            if (bytes > 262144 || rows.length >= 10000)
              throw new Error("Kết quả macro quá lớn.");
            rows.push(row);
          }
        } else {
          statement.run(p.args);
          changed = true;
        }
      }
      if (Date.now() >= job.deadline)
        throw Object.assign(new Error("Backend đã hết thời gian."), {
          code: "RUN_TIMEOUT",
        });
      const result = { rows: rows.length ? rows : [{ c1: "ok" }], changed };
      db.prepare("INSERT INTO system_backend_operations VALUES(?,?,?)").run(
        job.operationId,
        JSON.stringify(result, (_, v) =>
          typeof v === "bigint" ? String(v) : v,
        ),
        Date.now(),
      );
      return result;
    });
    for (;;) {
      try {
        return tx.immediate();
      } catch (e) {
        if (
          !["SQLITE_BUSY", "SQLITE_BUSY_SNAPSHOT"].includes(e.code) ||
          Date.now() >= job.deadline
        )
          throw e;
      }
    }
  } finally {
    db.close();
  }
}
async function report(sqlite, job) {
  const macro = sqlite
    .prepare("SELECT source,enabled FROM system_macros WHERE name=?")
    .get(job.name);
  if (!macro?.enabled) throw new Error("Macro không tồn tại hoặc đã tắt.");
  const sqls = statements(macro.source);
  if (sqls.length !== 1 || !/^(SELECT|WITH)\b/i.test(sqls[0]))
    throw new Error("Report chỉ nhận một truy vấn SELECT/WITH.");
  const duckdb = require("./dependencies.cjs")("duckdb");
  const db = await new Promise((resolve, reject) => {
    const instance = new duckdb.Database(
      ":memory:",
      {
        enable_external_access: "false",
        memory_limit: "128MB",
        threads: "1",
        max_temp_directory_size: "0B",
      },
      (e) => (e ? reject(e) : resolve(instance)),
    );
  });
  const run = (sql, args = []) =>
    new Promise((resolve, reject) =>
      db.run(sql, ...args, (e) => (e ? reject(e) : resolve())),
    );
  const all = (sql, args = []) =>
    new Promise((resolve, reject) =>
      db.all(sql, ...args, (e, r) => (e ? reject(e) : resolve(r))),
    );
  const quote = (s) => '"' + s.replaceAll('"', '""') + '"';
  try {
    // Copy a bounded snapshot. Report SQL cannot load extensions or read host files.
    sqlite.exec("BEGIN");
    let bytes = 0,
      count = 0;
    const tables = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'system_backend%'",
      )
      .all();
    for (const table of tables) {
      const columns = sqlite.pragma("table_info(" + quote(table.name) + ")");
      if (!columns.length) continue;
      const types = columns.map((c) =>
        /INT/i.test(c.type)
          ? "BIGINT"
          : /REAL|FLOAT|DOUBLE|NUMERIC|DECIMAL/i.test(c.type)
            ? "DOUBLE"
            : /BLOB/i.test(c.type)
              ? "BLOB"
              : "VARCHAR",
      );
      await run(
        `CREATE TABLE ${quote(table.name)}(${columns.map((c, i) => quote(c.name) + " " + types[i]).join(",")})`,
      );
      let batch = [];
      const flush = async () => {
        if (batch.length) {
          await run(
            `INSERT INTO ${quote(table.name)} VALUES ${batch.map(() => "(" + columns.map(() => "?").join(",") + ")").join(",")}`,
            batch.flat(),
          );
          batch = [];
        }
      };
      for (const row of sqlite
        .prepare("SELECT * FROM " + quote(table.name))
        .iterate()) {
        if (Date.now() >= job.deadline)
          throw Object.assign(new Error("Report hết thời gian."), {
            code: "RUN_TIMEOUT",
          });
        bytes += Buffer.byteLength(JSON.stringify(row));
        if (++count > 100000 || bytes > 16777216)
          throw new Error("Snapshot report vượt 100000 dòng hoặc 16 MiB.");
        batch.push(
          columns.map((c, i) =>
            row[c.name] == null
              ? null
              : types[i] === "VARCHAR"
                ? String(row[c.name])
                : row[c.name],
          ),
        );
        if (batch.length === 200) await flush();
      }
      await flush();
    }
    sqlite.exec("COMMIT");
    const p = parameters(sqls[0], job.bindings);
    const rows = await all(
      `SELECT * FROM (${p.sql}) AS backend_report LIMIT 10001`,
      p.args,
    );
    const encoded = JSON.stringify(rows, (_, v) =>
      typeof v === "bigint" ? String(v) : v,
    );
    if (rows.length > 10000 || Buffer.byteLength(encoded) > 262144)
      throw new Error("Kết quả report quá lớn.");
    return { rows: JSON.parse(encoded), changed: false };
  } finally {
    if (sqlite.inTransaction) sqlite.exec("ROLLBACK");
    await new Promise((resolve) => db.close(() => resolve()));
  }
}
process.on("message", async (job) => {
  try {
    process.send({ id: job.id, value: await execute(job) });
  } catch (e) {
    process.send({
      id: job.id,
      error: {
        code: e.code || "MACRO_FAILED",
        message: e.message,
        definitelyNotApplied: true,
      },
    });
  }
});
