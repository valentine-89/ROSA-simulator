"use strict";
const crypto = require("node:crypto");
const { IsolatePool } = require("./pool.cjs");
const { BackendStore } = require("./store.cjs");
const C = require("./contract.cjs");
class BackendService {
  constructor(options) {
    this.store = new BackendStore(options);
    this.pool = options.pool || new IsolatePool(options.runner);
    this.sdk = options.sdk;
    this.owner = crypto.randomUUID();
    this.running = new Set();
    this.timer = setInterval(() => this.pump(), 500);
    this.timer.unref();
    this.lastRecovery = 0;
  }
  pump() {
    try {
      if (Date.now() - this.lastRecovery > 10000) {
        this.store.recover();
        this.lastRecovery = Date.now();
      }
      if (this.running.size >= 2048) return;
      for (const run of this.store.claim(
        this.owner,
        Math.min(32, 2048 - this.running.size),
      ))
        void this.execute(run);
    } catch (e) {
      this.lastError = String(e.message);
    }
  }
  async execute(run) {
    this.running.add(run.id);
    const definition = this.store.runDefinition(run);
    let cpu = 0;
    const operations = new Set();
    const heartbeat = setInterval(() => {
      try {
        const limit = this.store.updateUsage(run.id, cpu);
        this.pool.budget?.(run.id, limit);
      } catch {}
    }, 1000);
    heartbeat.unref();
    try {
      const outcome = await this.pool.execute(
        {
          id: run.id,
          source: definition.source,
          input: JSON.parse(run.input),
          memoryMb: run.memory_mb,
          deadline: run.deadline,
          cpuLimitMs: run.cpu_limit_ms,
        },
        async (method, args, operationId) => {
          this.store.assertActive(run.id);
          C.assertCapability(definition, method, args);
          const operation = Promise.resolve().then(() =>
            this.sdk({
              run,
              definition,
              method,
              args,
              operationId,
              store: this.store,
            }),
          );
          operations.add(operation);
          try {
            return await operation;
          } finally {
            operations.delete(operation);
          }
        },
        (value) => {
          cpu = value;
        },
      );
      if (operations.size) {
        let timer;
        await Promise.race([
          Promise.allSettled([...operations]),
          new Promise((resolve) => {
            timer = setTimeout(resolve, Math.max(1, run.deadline - Date.now()));
          }),
        ]);
        clearTimeout(timer);
      }
      if (Date.now() >= run.deadline && !outcome.error)
        outcome.error = {
          code: "RUN_TIMEOUT",
          message: "Backend đã hết thời gian.",
        };
      this.store.complete(run.id, outcome);
    } catch (e) {
      this.store.complete(run.id, {
        cpuMs: cpu,
        error: { code: e.code || "RUN_FAILED", message: e.message },
        incomplete: true,
      });
    } finally {
      clearInterval(heartbeat);
      this.running.delete(run.id);
    }
  }
  close() {
    clearInterval(this.timer);
    this.pool.close();
  }
}
module.exports = {
  BackendService,
  BackendStore,
  IsolatePool,
  ...require("./database.cjs"),
  ...require("./remote.cjs"),
  ...C,
};
