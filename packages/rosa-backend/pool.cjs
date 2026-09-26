"use strict";
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const path = require("node:path");
const crypto = require("node:crypto");
const { fail, json } = require("./contract.cjs");
class IsolatePool {
  constructor(options = {}) {
    this.options = options;
    this.children = [];
    this.queue = [];
    this.closed = false;
    this.poolCount = options.poolCount || 2;
    this.poolMemoryMb = options.poolMemoryMb || 1024;
  }
  spawn() {
    const local = this.options.mode === "local";
    const containerName = `rosa-v8-${crypto.randomUUID()}`;
    const args = local
      ? ["--no-node-snapshot", path.join(__dirname, "isolate-worker.cjs")]
      : [
          "run",
          "--rm",
          "-i",
          "--name",
          containerName,
          "--network",
          "none",
          "--read-only",
          "--cap-drop",
          "ALL",
          "--security-opt",
          "no-new-privileges",
          "--pids-limit",
          "64",
          "--memory",
          `${this.poolMemoryMb}m`,
          "--memory-swap",
          `${this.poolMemoryMb}m`,
          "--cpus",
          String(this.options.cpusPerPool || 1),
          "--user",
          "10001:10001",
          this.options.image || "rosa-backend-runner:1",
        ];
    const child = spawn(local ? process.execPath : "docker", args, {
      cwd: __dirname,
      env: local
        ? {
            PATH: process.env.PATH,
            SystemRoot: process.env.SystemRoot,
            TEMP: process.env.TEMP,
            NODE_PATH:
              process.env.ROSA_SIMULATOR_NODE_MODULES || process.env.NODE_PATH,
            ROSA_SIMULATOR_NODE_MODULES:
              process.env.ROSA_SIMULATOR_NODE_MODULES,
          }
        : process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const slot = {
      child,
      containerName,
      runs: new Map(),
      reserved: 128,
      ready: false,
    };
    this.children.push(slot);
    let stderr = "";
    child.stderr.on("data", (data) => {
      stderr = (stderr + data.toString()).slice(-1000);
    });
    child.stdin.on("error", () => {});
    const lines = readline.createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      if (Buffer.byteLength(line) > 700000) {
        child.kill();
        return;
      }
      let m;
      try {
        m = JSON.parse(line);
      } catch {
        return;
      }
      if (m.type === "ready") {
        slot.ready = true;
        this.drain();
        return;
      }
      const run = slot.runs.get(m.id);
      if (!run) return;
      if (m.type === "usage") {
        run.cpuMs = Math.max(run.cpuMs, Number(m.cpuMs) || 0);
        run.onUsage?.(run.cpuMs);
      }
      if (m.type === "sdk") {
        if (Date.now() >= run.deadline || run.ended) return;
        Promise.resolve()
          .then(() => run.sdk(m.method, json(m.args), `${m.id}:${m.op}`))
          .then(
            (value) => ({
              value: json(value === undefined ? null : value, 262144),
            }),
            (e) => ({
              error: {
                code: e.code || "SDK_FAILED",
                message: String(e.message).slice(0, 500),
              },
            }),
          )
          .then((payload) => {
            if (!run.ended && Date.now() < run.deadline)
              this.send(slot, { type: "reply", id: m.id, op: m.op, payload });
          });
      }
      if (m.type === "done")
        this.finish(slot, run, {
          ...m,
          cpuMs: Math.max(run.cpuMs, Number(m.cpuMs) || 0),
        });
    });
    const dead = () => {
      if (slot.dead) return;
      slot.dead = true;
      slot.ready = false;
      this.children = this.children.filter((x) => x !== slot);
      const waiting = this.queue.splice(0);
      for (const run of [...slot.runs.values()])
        this.finish(slot, run, {
          error: {
            code: "RUNNER_LOST",
            message: "Runner đã dừng; tác động đã gửi cần đối soát.",
          },
          cpuMs: run.cpuMs,
          logs: [],
          incomplete: true,
        });
      if (!this.closed && waiting.length) {
        for (const run of waiting) {
          clearTimeout(run.timer);
          run.ended = true;
          run.resolve({
            error: {
              code: "RUNNER_UNAVAILABLE",
              message: "Không khởi động được runner.",
            },
            cpuMs: 0,
            logs: [],
          });
        }
      }
    };
    child.once("error", dead);
    child.once("exit", dead);
    return slot;
  }
  send(slot, value) {
    if (slot.child.stdin.writable)
      slot.child.stdin.write(JSON.stringify(value) + "\n");
  }
  availableSlots(memoryMb) {
    const reserve = memoryMb * 3;
    return Math.max(0, this.children.reduce((n,s) => n + Math.max(0,Math.floor((this.poolMemoryMb-s.reserved)/reserve)),0)
      + Math.max(0,this.poolCount-this.children.length)*Math.max(0,Math.floor((this.poolMemoryMb-128)/reserve)) - this.queue.length);
  }
  execute(job, sdk, onUsage) {
    if (this.closed) throw fail("RUNNER_CLOSED", "Runner đã đóng.", 503);
    return new Promise((resolve) => {
      const run = {
        ...job,
        sdk,
        onUsage,
        resolve,
        cpuMs: 0,
        ended: false,
        reservation: job.memoryMb * 3,
      };
      if (run.reservation + 128 > this.poolMemoryMb) {
        resolve({
          error: { code: "POOL_TOO_SMALL", message: "RAM pool không đủ." },
          cpuMs: 0,
          logs: [],
        });
        return;
      }
      run.timer = setTimeout(
        () => {
          const slot = this.children.find((s) => s.runs.has(run.id));
          if (slot) {
            this.send(slot, { type: "cancel", id: run.id });
            run.killTimer = setTimeout(() => {
              if (slot.runs.has(run.id)) {
                slot.child.kill("SIGKILL");
                if (this.options.mode !== "local")
                  spawn("docker", ["kill", slot.containerName], {
                    stdio: "ignore",
                    windowsHide: true,
                  });
              }
            }, 1500);
          } else {
            this.queue = this.queue.filter((x) => x !== run);
            run.ended = true;
            resolve({
              error: {
                code: "RUN_TIMEOUT",
                message: "Hết thời gian chờ tài nguyên.",
              },
              cpuMs: 0,
              logs: [],
            });
          }
        },
        Math.max(1, run.deadline - Date.now()),
      );
      this.queue.push(run);
      this.drain();
    });
  }
  drain() {
    if (this.closed) return;
    for (const run of [...this.queue]) {
      let slot = this.children.find(
        (s) => s.ready && s.reserved + run.reservation <= this.poolMemoryMb,
      );
      if (!slot && this.children.length < this.poolCount) {
        this.spawn();
        continue;
      }
      if (!slot) continue;
      this.queue.splice(this.queue.indexOf(run), 1);
      slot.runs.set(run.id, run);
      slot.reserved += run.reservation;
      this.send(slot, {
        type: "run",
        id: run.id,
        source: run.source,
        input: run.input,
        memoryMb: run.memoryMb,
        deadline: run.deadline,
        cpuLimitMs: run.cpuLimitMs,
      });
    }
  }
  finish(slot, run, result) {
    if (run.ended) return;
    run.ended = true;
    clearTimeout(run.timer);
    clearTimeout(run.killTimer);
    slot.runs.delete(run.id);
    slot.reserved -= run.reservation;
    if (Date.now() >= run.deadline && !result.error)
      result.error = {
        code: "RUN_TIMEOUT",
        message: "Backend đã hết thời gian.",
      };
    run.resolve(result);
    this.drain();
  }
  budget(id, cpuLimitMs) {
    for (const slot of this.children)
      if (slot.runs.has(id))
        this.send(slot, { type: "budget", id, cpuLimitMs });
  }
  cancel(id) {
    const queued = this.queue.find((r) => r.id === id);
    if (queued) {
      this.queue = this.queue.filter((r) => r !== queued);
      clearTimeout(queued.timer);
      queued.ended = true;
      queued.resolve({
        error: { code: "RUN_CANCELLED", message: "Lượt chạy đã hủy." },
        cpuMs: 0,
        logs: [],
      });
    }
    for (const slot of this.children)
      if (slot.runs.has(id)) this.send(slot, { type: "cancel", id });
  }
  close() {
    this.closed = true;
    for (const run of this.queue.splice(0)) {
      clearTimeout(run.timer);
      run.resolve({
        error: { code: "RUNNER_CLOSED", message: "Runner đã đóng." },
        cpuMs: 0,
        logs: [],
      });
    }
    for (const slot of this.children) slot.child.stdin.end();
  }
}
module.exports = { IsolatePool };
