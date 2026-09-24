"use strict";
const Database = require("./dependencies.cjs")("better-sqlite3");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const C = require("./contract.cjs");
class BackendStore {
  constructor({ statePath, iodataDir, simulation = false }) {
    this.iodataDir = iodataDir;
    this.simulation = simulation;
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.mkdirSync(iodataDir, { recursive: true });
    this.db = new Database(statePath);
    this.db.pragma("journal_mode=WAL");
    this.db.pragma("busy_timeout=5000");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS backend_bindings(ioid TEXT NOT NULL,name TEXT NOT NULL,config TEXT NOT NULL,publication TEXT,PRIMARY KEY(ioid,name));
      CREATE TABLE IF NOT EXISTS backend_sessions(token_hash TEXT PRIMARY KEY,ioid TEXT NOT NULL,expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS backend_runs(id TEXT PRIMARY KEY,ioid TEXT NOT NULL,name TEXT NOT NULL,scope TEXT NOT NULL,request_key TEXT NOT NULL,input_hash TEXT NOT NULL,definition TEXT NOT NULL,input TEXT NOT NULL,sync_id TEXT NOT NULL,status TEXT NOT NULL,created INTEGER NOT NULL,deadline INTEGER NOT NULL,memory_mb INTEGER NOT NULL,cpu_price REAL NOT NULL,service_price REAL NOT NULL,cpu_ms REAL NOT NULL DEFAULT 0,cpu_limit_ms REAL NOT NULL DEFAULT 0,reserved REAL NOT NULL DEFAULT 0,cpu_cost REAL NOT NULL DEFAULT 0,service_cost REAL NOT NULL DEFAULT 0,result TEXT,error TEXT,logs TEXT,owner TEXT,heartbeat INTEGER,finished INTEGER,incomplete INTEGER NOT NULL DEFAULT 0,UNIQUE(ioid,name,scope,request_key));
      CREATE INDEX IF NOT EXISTS backend_runs_pending ON backend_runs(status,created);
      CREATE INDEX IF NOT EXISTS backend_runs_payer ON backend_runs(sync_id,status);
      CREATE INDEX IF NOT EXISTS backend_runs_finished ON backend_runs(finished);
      CREATE TABLE IF NOT EXISTS backend_definitions(hash TEXT PRIMARY KEY,definition TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS backend_operations(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,status TEXT NOT NULL,result TEXT,cost REAL NOT NULL DEFAULT 0,kind TEXT,updated INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS backend_operations_run ON backend_operations(run_id);
    `);
    if (simulation)
      this.db.exec(
        `CREATE TABLE IF NOT EXISTS sync_data(syncId TEXT PRIMARY KEY,costLimit REAL DEFAULT 1000000,costUsed REAL DEFAULT 0,lastActivityTime INTEGER);INSERT OR IGNORE INTO sync_data(syncId) VALUES('SIM_SYNC');`,
      );
  }
  file(ioid) {
    return path.join(this.iodataDir, `${C.ioid(ioid)}.sqlite`);
  }
  data(ioid) {
    const db = new Database(this.file(ioid));
    db.pragma("journal_mode=WAL");
    db.pragma("busy_timeout=5000");
    db.exec(`CREATE TABLE IF NOT EXISTS system_backends(name TEXT PRIMARY KEY,definition TEXT NOT NULL,updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS system_backend_versions(version TEXT PRIMARY KEY,name TEXT NOT NULL,definition TEXT NOT NULL,created_at INTEGER NOT NULL);`);
    return db;
  }
  list(ioid) {
    const db = this.data(ioid);
    try {
      return db
        .prepare(
          "SELECT name,definition,updated_at FROM system_backends ORDER BY name",
        )
        .all()
        .map((row) => ({
          ...JSON.parse(row.definition),
          updatedAt: row.updated_at,
          config: this.config(ioid, row.name, true),
        }));
    } finally {
      db.close();
    }
  }
  draft(ioid, name) {
    const db = this.data(ioid);
    try {
      const row = db
        .prepare("SELECT definition FROM system_backends WHERE name=?")
        .get(C.name(name));
      if (!row) throw C.fail("NOT_FOUND", "Backend không tồn tại.", 404);
      return JSON.parse(row.definition);
    } finally {
      db.close();
    }
  }
  save(ioid, raw, expectedRevision) {
    const value = C.json(raw, C.LIMITS.source + 131072);
    const d = Object.fromEntries(
      [
        "name",
        "description",
        "source",
        "inputSchema",
        "outputSchema",
        "permissions",
        "contractVersion",
      ]
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, value[key]]),
    );
    C.name(d.name);
    if (
      typeof d.source !== "string" ||
      Buffer.byteLength(d.source) > C.LIMITS.source
    )
      throw C.fail("INVALID_SOURCE", "Mã nguồn quá lớn.");
    const db = this.data(ioid);
    try {
      db.transaction(() => {
        this.assertDraftRevision(db, d.name, expectedRevision);
        db.prepare(
          "INSERT INTO system_backends(name,definition,updated_at) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET definition=excluded.definition,updated_at=excluded.updated_at",
        ).run(d.name, JSON.stringify(d), Date.now());
      }).immediate();
    } finally {
      db.close();
    }
    return d;
  }
  assertDraftRevision(db, name, expectedRevision) {
    if (expectedRevision === undefined) return;
    const row = db.prepare("SELECT definition FROM system_backends WHERE name=?").get(name);
    const actual = row ? C.hash(JSON.parse(row.definition)) : null;
    if (actual !== expectedRevision)
      throw C.fail("REVISION_CONFLICT", "Backend đã thay đổi. Đọc lại trước khi sửa hoặc xóa.", 409);
  }
  remove(ioid, name, expectedRevision) {
    C.name(name);
    if (typeof expectedRevision !== "string") throw C.fail("REVISION_REQUIRED", "Cần revision từ get_backend.");
    const db = this.data(ioid);
    try {
      return db.transaction(() => {
        this.assertDraftRevision(db, name, expectedRevision);
        // Revoke new invocations first. Existing runs retain their immutable source and billing records.
        this.db.prepare("DELETE FROM backend_bindings WHERE ioid=? AND name=?").run(ioid, name);
        db.prepare("DELETE FROM system_backend_versions WHERE name=?").run(name);
        const deleted = db.prepare("DELETE FROM system_backends WHERE name=?").run(name).changes > 0;
        return { name, deleted };
      }).immediate();
    } finally { db.close(); }
  }
  config(ioid, name, redact = false) {
    const row = this.db
      .prepare(
        "SELECT config,publication FROM backend_bindings WHERE ioid=? AND name=?",
      )
      .get(C.ioid(ioid), C.name(name));
    if (!row)
      return {
        externalEnabled: false,
        authType: "bearer",
        username: "",
        syncId: "",
        enabled: false,
      };
    const c = JSON.parse(row.config);
    c.published = !!row.publication;
    if (redact) {
      c.hasKey = !!c.keyHash;
      delete c.keyHash;
    }
    return c;
  }
  configure(ioid, name, raw) {
    const old = this.config(ioid, name);
    const c = {
      ...old,
      syncId: String(raw.syncId || ""),
      externalEnabled: raw.externalEnabled === true,
      authType: raw.authType || "bearer",
      username: String(raw.username || ""),
      enabled: raw.enabled !== false,
    };
    if (!["bearer", "api-key", "basic"].includes(c.authType))
      throw C.fail("INVALID_AUTH", "Loại xác thực không hợp lệ.");
    if (raw.apiKey) {
      if (
        typeof raw.apiKey !== "string" ||
        raw.apiKey.length < 24 ||
        raw.apiKey.length > 256 ||
        /\s/.test(raw.apiKey)
      )
        throw C.fail(
          "INVALID_KEY",
          "API key cần 24–256 ký tự, không có khoảng trắng.",
        );
      c.keyHash = C.hash(raw.apiKey);
    }
    if (
      c.externalEnabled &&
      (!c.keyHash ||
        (c.authType === "basic" && (!c.username || /[:\r\n]/.test(c.username))))
    )
      throw C.fail("AUTH_REQUIRED", "Cần API key và username cho Basic.");
    const payer = this.db
      .prepare("SELECT syncId FROM sync_data WHERE syncId=?")
      .get(c.syncId);
    if (!payer) throw C.fail("SYNC_NOT_FOUND", "SyncID không tồn tại.");
    delete c.published;
    delete c.hasKey;
    this.db
      .prepare(
        "INSERT INTO backend_bindings(ioid,name,config) VALUES(?,?,?) ON CONFLICT(ioid,name) DO UPDATE SET config=excluded.config",
      )
      .run(ioid, name, JSON.stringify(c));
    return this.config(ioid, name, true);
  }
  publish(ioid, name, deviceGrants = {}, expectedRevision) {
    const draft = this.draft(ioid, name);
    if (expectedRevision !== undefined && C.hash(draft) !== expectedRevision)
      throw C.fail("REVISION_CONFLICT", "Backend đã thay đổi. Đọc lại trước khi phát hành.", 409);
    const d = C.definition(draft);
    const version = C.hash(d);
    const db = this.data(ioid);
    try {
      db.prepare(
        "INSERT OR IGNORE INTO system_backend_versions VALUES(?,?,?,?)",
      ).run(version, name, JSON.stringify(d), Date.now());
    } finally {
      db.close();
    }
    if (
      !this.db
        .prepare(
          "UPDATE backend_bindings SET publication=? WHERE ioid=? AND name=?",
        )
        .run(
          JSON.stringify({ version, definition: d, deviceGrants }),
          ioid,
          name,
        ).changes
    )
      throw C.fail(
        "CONFIG_REQUIRED",
        "Cần cấu hình SyncID trước khi phát hành.",
      );
    return { version };
  }
  published(ioid, name) {
    const row = this.db
      .prepare(
        "SELECT config,publication FROM backend_bindings WHERE ioid=? AND name=?",
      )
      .get(C.ioid(ioid), C.name(name));
    if (!row?.publication || !JSON.parse(row.config).enabled)
      throw C.fail(
        "NOT_FOUND",
        "Backend chưa được phát hành hoặc đã tắt.",
        404,
      );
    const p = JSON.parse(row.publication);
    const db = this.data(ioid);
    try {
      const v = db
        .prepare(
          "SELECT definition FROM system_backend_versions WHERE version=? AND name=?",
        )
        .get(p.version, name);
      if (!v || C.hash(JSON.parse(v.definition)) !== p.version)
        throw C.fail(
          "PUBLISH_REQUIRED",
          "Database đã thay đổi; cần phát hành lại.",
          409,
        );
    } finally {
      db.close();
    }
    return { ...p.definition, deviceGrants: p.deviceGrants || {} };
  }
  session(ioid) {
    const token = crypto.randomBytes(32).toString("hex");
    this.db
      .prepare("DELETE FROM backend_sessions WHERE expires<?")
      .run(Date.now());
    this.db
      .prepare("INSERT INTO backend_sessions VALUES(?,?,?)")
      .run(C.hash(token), C.ioid(ioid), Date.now() + 8 * 3600000);
    return token;
  }
  sessionIoid(token) {
    const row = this.db
      .prepare(
        "SELECT ioid FROM backend_sessions WHERE token_hash=? AND expires>?",
      )
      .get(C.hash(String(token || "")), Date.now());
    if (!row) throw C.fail("UNAUTHORIZED", "Cần kết nối thiết bị.", 401);
    return row.ioid;
  }
  available(syncId, exclude = "") {
    const row = this.db
      .prepare(
        "SELECT COALESCE(costLimit,0)-COALESCE(costUsed,0) balance FROM sync_data WHERE syncId=?",
      )
      .get(syncId);
    const held = this.db
      .prepare(
        "SELECT COALESCE(SUM(reserved),0) held FROM backend_runs WHERE sync_id=? AND id<>? AND status IN ('queued','running')",
      )
      .get(syncId, exclude);
    return Number(row?.balance || 0) - held.held;
  }
  submit({
    ioid,
    name,
    input,
    requestKey,
    scope,
    definition,
    settings,
    test = false,
  }) {
    input = C.json(input);
    C.validateSchema(definition.inputSchema, input);
    if (
      settings.cpuPrice === null ||
      !Number.isFinite(settings.cpuPrice) ||
      settings.cpuPrice < 0
    )
      throw C.fail("PRICE_REQUIRED", "Quản trị chưa đặt giá CPU.", 503);
    if (
      typeof requestKey !== "string" ||
      requestKey.length < 8 ||
      requestKey.length > 128
    )
      throw C.fail("INVALID_REQUEST_ID", "Cần requestId 8–128 ký tự.");
    const config = this.config(ioid, name);
    const payer = config.syncId;
    const inputHash = C.hash({ input, definition, test });
    const id = crypto.randomUUID();
    const now = Date.now();
    this.db
      .transaction(() => {
        const prior = this.db
          .prepare(
            "SELECT * FROM backend_runs WHERE ioid=? AND name=? AND scope=? AND request_key=?",
          )
          .get(ioid, name, scope, requestKey);
        if (prior) {
          if (prior.input_hash !== inputHash)
            throw C.fail(
              "IDEMPOTENCY_CONFLICT",
              "requestId đã dùng cho nội dung khác.",
              409,
            );
          return;
        }
        const available = this.available(payer);
        if (available <= 0)
          throw C.fail("BALANCE_EXHAUSTED", "SyncID hết số dư.", 402);
        const reserve = Math.min(available, settings.cpuPrice * 2);
        const cpuLimit =
          settings.cpuPrice > 0
            ? (reserve / settings.cpuPrice) * 1000
            : settings.timeoutSeconds * 1000;
        const definitionHash = C.hash(definition);
        this.db
          .prepare("INSERT OR IGNORE INTO backend_definitions VALUES(?,?)")
          .run(definitionHash, JSON.stringify(definition));
        this.db
          .prepare(
            `INSERT INTO backend_runs(id,ioid,name,scope,request_key,input_hash,definition,input,sync_id,status,created,deadline,memory_mb,cpu_price,service_price,cpu_limit_ms,reserved) VALUES(?,?,?,?,?,?,?,?,?,'queued',?,?,?,?,?,?,?)`,
          )
          .run(
            id,
            ioid,
            name,
            scope,
            requestKey,
            inputHash,
            definitionHash,
            JSON.stringify(input),
            payer,
            now,
            now + settings.timeoutSeconds * 1000,
            settings.memoryMb,
            settings.cpuPrice,
            settings.servicePrice || 0,
            cpuLimit,
            reserve,
          );
      })
      .immediate();
    return this.view(
      this.db
        .prepare(
          "SELECT * FROM backend_runs WHERE ioid=? AND name=? AND scope=? AND request_key=?",
        )
        .get(ioid, name, scope, requestKey),
    );
  }
  claim(owner, limit = 32) {
    return this.db
      .transaction(() => {
        const rows = this.db
          .prepare(
            "SELECT * FROM backend_runs WHERE status='queued' ORDER BY created LIMIT ?",
          )
          .all(limit);
        for (const row of rows)
          this.db
            .prepare(
              "UPDATE backend_runs SET status='running',owner=?,heartbeat=? WHERE id=? AND status='queued'",
            )
            .run(owner, Date.now(), row.id);
        return rows.map((r) => ({ ...r, status: "running", owner }));
      })
      .immediate();
  }
  updateUsage(id, cpuMs) {
    return this.db
      .transaction(() => {
        const row = this.raw(id);
        if (row.status !== "running") return 0;
        const used = Math.max(row.cpu_ms, cpuMs);
        const cost = (used / 1000) * row.cpu_price;
        const available = Math.max(0, this.available(row.sync_id, id));
        const reserve = Math.min(available, cost + row.cpu_price * 2);
        const limit =
          row.cpu_price > 0
            ? Math.max(used, (reserve / row.cpu_price) * 1000)
            : Math.max(0, row.deadline - row.created);
        this.db
          .prepare(
            "UPDATE backend_runs SET cpu_ms=?,reserved=?,cpu_limit_ms=?,heartbeat=? WHERE id=?",
          )
          .run(used, reserve, limit, Date.now(), id);
        return limit;
      })
      .immediate();
  }
  raw(id) {
    const row = this.db
      .prepare("SELECT * FROM backend_runs WHERE id=?")
      .get(id);
    if (!row) throw C.fail("NOT_FOUND", "Không tìm thấy lượt chạy.", 404);
    return row;
  }
  runDefinition(row) {
    const stored = this.db
      .prepare("SELECT definition FROM backend_definitions WHERE hash=?")
      .get(row.definition);
    if (!stored)
      throw C.fail("DEFINITION_LOST", "Không tìm thấy phiên bản backend.", 500);
    return JSON.parse(stored.definition);
  }
  assertActive(id) {
    const row = this.raw(id);
    if (row.status !== "running" || Date.now() >= row.deadline)
      throw C.fail("RUN_ENDED", "Lượt chạy đã kết thúc.", 409);
    return row;
  }
  charge(row, kind, cost, blocks) {
    if (!cost) return;
    this.db
      .prepare(
        "UPDATE sync_data SET costUsed=COALESCE(costUsed,0)+?,lastActivityTime=? WHERE syncId=?",
      )
      .run(cost, Date.now(), row.sync_id);
    if (!this.simulation)
      this.db
        .prepare(
          `INSERT INTO sync_usage_cost_hourly(syncId,bucketStart,kind,blocks,cost) VALUES(?,?,?,?,?) ON CONFLICT(syncId,bucketStart,kind) DO UPDATE SET blocks=blocks+excluded.blocks,cost=cost+excluded.cost`,
        )
        .run(
          row.sync_id,
          Math.floor(Date.now() / 3600000) * 3600000,
          kind,
          blocks,
          cost,
        );
  }
  complete(id, outcome) {
    return this.db
      .transaction(() => {
        const row = this.raw(id);
        if (!["running", "queued"].includes(row.status)) return this.view(row);
        let error = outcome.error;
        if (!error) {
          try {
            C.validateSchema(
              this.runDefinition(row).outputSchema,
              C.json(outcome.result, C.LIMITS.output),
            );
          } catch (e) {
            error = { code: "OUTPUT_INVALID", message: e.message };
          }
        }
        const cpuMs = Math.max(row.cpu_ms, Number(outcome.cpuMs) || 0);
        const cost = (cpuMs / 1000) * row.cpu_price;
        this.charge(row, "backend_cpu", cost, cpuMs / 1000);
        this.db
          .prepare(
            `UPDATE backend_runs SET status=?,cpu_ms=?,cpu_cost=?,reserved=0,result=?,error=?,logs=?,finished=?,incomplete=? WHERE id=?`,
          )
          .run(
            error ? "failed" : "succeeded",
            cpuMs,
            cost,
            error ? null : JSON.stringify(outcome.result),
            error ? JSON.stringify(error) : null,
            JSON.stringify(outcome.logs || []),
            Date.now(),
            outcome.incomplete ? 1 : 0,
            id,
          );
        return this.view(this.raw(id));
      })
      .immediate();
  }
  beginOperation(runId, id, kind, cost) {
    return this.db
      .transaction(() => {
        const run = this.assertActive(runId);
        const prior = this.db
          .prepare("SELECT * FROM backend_operations WHERE id=?")
          .get(id);
        if (prior) return prior;
        if (this.available(run.sync_id) < cost)
          throw C.fail(
            "BALANCE_EXHAUSTED",
            "SyncID không đủ số dư dịch vụ.",
            402,
          );
        this.charge(run, kind, cost, 1);
        this.db
          .prepare(
            "UPDATE backend_runs SET service_cost=service_cost+? WHERE id=?",
          )
          .run(cost, runId);
        this.db
          .prepare(
            "INSERT INTO backend_operations VALUES(?,?,'started',NULL,?,?,?)",
          )
          .run(id, runId, cost, kind, Date.now());
        return null;
      })
      .immediate();
  }
  endOperation(id, result) {
    this.db
      .prepare(
        "UPDATE backend_operations SET status='done',result=?,updated=? WHERE id=?",
      )
      .run(JSON.stringify(result), Date.now(), id);
  }
  failOperation(id, error) {
    this.db
      .transaction(() => {
        const op = this.db
          .prepare("SELECT * FROM backend_operations WHERE id=?")
          .get(id);
        if (!op || op.status !== "started") return;
        const run = this.raw(op.run_id);
        if (error.definitelyNotApplied) {
          this.charge(run, op.kind, -op.cost, -1);
          this.db
            .prepare(
              "UPDATE backend_runs SET service_cost=service_cost-? WHERE id=?",
            )
            .run(op.cost, op.run_id);
        }
        this.db
          .prepare(
            "UPDATE backend_operations SET status=?,result=?,updated=? WHERE id=?",
          )
          .run(
            error.definitelyNotApplied ? "failed" : "uncertain",
            JSON.stringify({ error: error.code || "SDK_FAILED" }),
            Date.now(),
            id,
          );
      })
      .immediate();
  }
  view(row) {
    return {
      runId: row.id,
      name: row.name,
      status: row.status,
      createdAt: row.created,
      deadline: row.deadline,
      cpuMs: row.cpu_ms,
      wallMs: (row.finished || Date.now()) - row.created,
      cpuCost: row.cpu_cost,
      serviceCost: row.service_cost,
      result: row.result ? JSON.parse(row.result) : null,
      error: row.error ? JSON.parse(row.error) : null,
      logs: row.logs ? JSON.parse(row.logs) : [],
      incomplete: !!row.incomplete,
    };
  }
  recover() {
    // Bounded retention work; wallet aggregates remain in the existing ledger.
    const cutoff = Date.now() - 7 * 86400000;
    this.db
      .transaction(() => {
        this.db
          .prepare(
            "DELETE FROM backend_operations WHERE run_id IN (SELECT id FROM backend_runs WHERE finished<? ORDER BY finished LIMIT 500)",
          )
          .run(cutoff);
        this.db
          .prepare(
            "DELETE FROM backend_runs WHERE id IN (SELECT id FROM backend_runs WHERE finished<? ORDER BY finished LIMIT 500)",
          )
          .run(cutoff);
        this.db
          .prepare("DELETE FROM backend_sessions WHERE expires<?")
          .run(Date.now());
      })
      .immediate();
    const rows = this.db
      .prepare(
        "SELECT * FROM backend_runs WHERE status='running' AND heartbeat<?",
      )
      .all(Date.now() - 30000);
    for (const row of rows)
      this.complete(row.id, {
        error: {
          code: "RUNNER_LOST",
          message: "Mất runner, cần đối soát tác động.",
        },
        cpuMs: row.cpu_ms,
        incomplete: true,
      });
    const expired = this.db
      .prepare(
        "SELECT * FROM backend_runs WHERE status='queued' AND deadline<?",
      )
      .all(Date.now());
    for (const row of expired)
      this.complete(row.id, {
        error: {
          code: "RUN_TIMEOUT",
          message: "Hết thời gian chờ tài nguyên.",
        },
        cpuMs: 0,
      });
  }
  close() {
    this.db.close();
  }
}
module.exports = { BackendStore };
