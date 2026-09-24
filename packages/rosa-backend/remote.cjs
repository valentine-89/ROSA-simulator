"use strict";
const { WebSocket, WebSocketServer } = require("ws");
const crypto = require("node:crypto");
const C = require("./contract.cjs");
const { IsolatePool } = require("./pool.cjs");
// Authenticated transport is outside the networkless V8 containers. Only JSON
// crosses it; device credentials and SQLite files stay on the coordinator.
class RemotePool {
  constructor(endpoints) {
    if (!Array.isArray(endpoints) || !endpoints.length)
      throw new Error("BACKEND_RUNNERS cần ít nhất một runner.");
    this.runs = new Map();
    this.clients = endpoints.map((e) => ({
      url: e.url,
      token: process.env[e.tokenEnv],
      ws: null,
      pending: new Map(),
      load: 0,
    }));
    for (const c of this.clients) {
      const u = new URL(c.url);
      if (
        u.protocol !== "wss:" &&
        !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)
      )
        throw new Error("Runner ở máy khác cần wss://.");
      if (!c.token || c.token.length < 32)
        throw new Error("Thiếu token runner (ít nhất 32 ký tự).");
    }
  }
  connect(c) {
    if (c.connecting) return c.connecting;
    c.connecting = new Promise((resolve, reject) => {
      const ws = (c.ws = new WebSocket(c.url, {
        headers: { authorization: "Bearer " + c.token },
        maxPayload: 700000,
        handshakeTimeout: 10000,
      }));
      ws.on("open", () => resolve(ws));
      ws.on("error", reject);
      ws.on("message", (raw) => {
        let m;
        try {
          m = JSON.parse(raw);
        } catch {
          return ws.close();
        }
        const r = c.pending.get(m.id);
        if (!r) return;
        if (m.type === "usage") {
          r.cpuMs = Math.max(r.cpuMs, m.cpuMs || 0);
          r.usage(r.cpuMs);
        }
        if (m.type === "done") this.finish(c, r, m.outcome);
        if (m.type === "sdk")
          Promise.resolve()
            .then(() => r.sdk(m.method, C.json(m.args), m.operationId))
            .then(
              (value) => ({
                value: C.json(value === undefined ? null : value, 262144),
              }),
              (e) => ({
                error: { code: e.code || "SDK_FAILED", message: e.message },
              }),
            )
            .then((payload) => {
              if (ws.readyState === WebSocket.OPEN)
                ws.send(
                  JSON.stringify({
                    type: "reply",
                    id: m.id,
                    op: m.op,
                    payload,
                  }),
                );
            });
      });
      ws.on("close", () => {
        c.connecting = null;
        c.ws = null;
        for (const r of [...c.pending.values()])
          this.finish(c, r, {
            error: {
              code: "RUNNER_LOST",
              message: "Mất kết nối runner; cần đối soát tác động.",
            },
            cpuMs: r.cpuMs,
            incomplete: true,
          });
        reject(new Error("Runner connection closed"));
      });
    });
    return c.connecting;
  }
  async execute(job, sdk, usage = () => {}) {
    const c = [...this.clients].sort((a, b) => a.load - b.load)[0];
    c.load++;
    try {
      const ws = await this.connect(c);
      return await new Promise((resolve) => {
        const r = { ...job, sdk, usage, resolve, cpuMs: 0 };
        c.pending.set(job.id, r);
        this.runs.set(job.id, c);
        r.timer = setTimeout(
          () => {
            this.send(c, { type: "cancel", id: job.id });
            this.finish(c, r, {
              error: { code: "RUN_TIMEOUT", message: "Backend hết thời gian." },
              cpuMs: r.cpuMs,
              incomplete: true,
            });
          },
          Math.max(1, job.deadline - Date.now()) + 2000,
        );
        ws.send(JSON.stringify({ type: "run", job }));
      });
    } catch (e) {
      return {
        error: {
          code: "RUNNER_UNAVAILABLE",
          message: "Không kết nối được runner.",
        },
        cpuMs: 0,
      };
    } finally {
      c.load--;
    }
  }
  finish(c, r, outcome) {
    if (!c.pending.delete(r.id)) return;
    clearTimeout(r.timer);
    this.runs.delete(r.id);
    r.resolve(outcome);
  }
  send(c, m) {
    if (c?.ws?.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(m));
  }
  budget(id, cpuLimitMs) {
    this.send(this.runs.get(id), { type: "budget", id, cpuLimitMs });
  }
  close() {
    for (const c of this.clients) c.ws?.close();
  }
}
function runnerServer(options = {}) {
  const token = options.token || process.env.BACKEND_RUNNER_TOKEN;
  if (!token || token.length < 32)
    throw new Error("BACKEND_RUNNER_TOKEN cần ít nhất 32 ký tự.");
  const pool =
    options.pool ||
    new IsolatePool({
      mode: "docker",
      poolCount: Number(process.env.BACKEND_POOL_COUNT || 2),
      poolMemoryMb: Number(process.env.BACKEND_POOL_MEMORY_MB || 1024),
      cpusPerPool: Number(process.env.BACKEND_POOL_CPUS || 1),
    });
  const server = new WebSocketServer({
    port: options.port ?? Number(process.env.BACKEND_RUNNER_PORT || 4190),
    host: options.host || "127.0.0.1",
    maxPayload: 700000,
    verifyClient: ({ req }) =>
      C.secretMatches(
        String(req.headers.authorization || "").replace(/^Bearer /, ""),
        C.hash(token),
      ),
  });
  server.on("connection", (ws) => {
    const active = new Set(),
      pending = new Map();
    const send = (m) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
    };
    ws.on("message", async (raw) => {
      try {
        const m = JSON.parse(raw);
        if (m.type === "run") {
          const j = C.json(m.job, 650000);
          if (
            typeof j.id !== "string" ||
            active.has(j.id) ||
            active.size >= 4096 ||
            j.memoryMb < 8 ||
            j.memoryMb > 128 ||
            !Number.isFinite(j.deadline) ||
            j.deadline > Date.now() + 3600000 ||
            typeof j.source !== "string"
          )
            return ws.close();
          active.add(j.id);
          const outcome = await pool.execute(
            j,
            (method, args, operationId) =>
              new Promise((resolve, reject) => {
                const op = crypto.randomUUID();
                pending.set(op, { id: j.id, resolve, reject });
                send({ type: "sdk", id: j.id, op, method, args, operationId });
              }),
            (cpuMs) => send({ type: "usage", id: j.id, cpuMs }),
          );
          active.delete(j.id);
          for (const [op, r] of pending)
            if (r.id === j.id) {
              pending.delete(op);
              r.reject(new Error("RUN_ENDED"));
            }
          send({ type: "done", id: j.id, outcome });
        } else if (m.type === "reply") {
          const r = pending.get(m.op);
          if (r && r.id === m.id) {
            pending.delete(m.op);
            m.payload.error
              ? r.reject(
                  Object.assign(
                    new Error(m.payload.error.message),
                    m.payload.error,
                  ),
                )
              : r.resolve(m.payload.value);
          }
        } else if (active.has(m.id)) {
          if (m.type === "budget") pool.budget(m.id, m.cpuLimitMs);
          if (m.type === "cancel") pool.cancel(m.id);
        }
      } catch {
        ws.close();
      }
    });
    ws.on("close", () => {
      for (const id of active) pool.cancel(id);
      for (const r of pending.values()) r.reject(new Error("COORDINATOR_LOST"));
      pending.clear();
    });
  });
  server.on("close", () => pool.close());
  return server;
}
if (require.main === module) runnerServer();
module.exports = { RemotePool, runnerServer };
