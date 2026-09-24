"use strict";
const { fork, spawn } = require("node:child_process");
const readline = require("node:readline");
const path = require("node:path");
const crypto = require("node:crypto");
class DatabasePool {
  constructor(options = 4) {
    this.options = typeof options === "number" ? { size: options } : options;
    this.size = this.options.size || 4;
    this.workers = [];
    this.queue = [];
    this.closed = false;
  }
  execute(job) {
    if (this.closed) return Promise.reject(new Error("Database pool đã đóng."));
    if (
      this.options.mode === "docker" &&
      path.resolve(path.dirname(job.file)) !==
        path.resolve(this.options.iodataDir)
    )
      return Promise.reject(
        new Error("Database path is outside the configured IoData directory."),
      );
    return new Promise((resolve, reject) => {
      this.queue.push({ ...job, id: crypto.randomUUID(), resolve, reject });
      this.drain();
    });
  }
  drain() {
    if (this.closed) return;
    while (this.queue.length) {
      let slot = this.workers.find((x) => !x.job && !x.dying);
      if (!slot && this.workers.length < this.size) {
        const containerName =
          this.options.mode === "docker"
            ? "rosa-db-" + crypto.randomUUID()
            : null;
        const worker = containerName
          ? spawn(
              "docker",
              [
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
                "256m",
                "--memory-swap",
                "256m",
                "--cpus",
                "1",
                "--user",
                `${Math.max(1, process.getuid?.() ?? 1000)}:${Math.max(1, process.getgid?.() ?? 1000)}`,
                "--mount",
                `type=bind,source=${path.resolve(this.options.iodataDir)},target=/data`,
                this.options.image || "rosa-backend-database:1",
              ],
              { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
            )
          : fork(path.join(__dirname, "database-worker.cjs"), [], {
              execArgv: ["--max-old-space-size=192"],
              stdio: ["ignore", "ignore", "pipe", "ipc"],
              windowsHide: true,
            });
        if (containerName) {
          worker.stdin.on("error", () => {});
          worker.send = (message) =>
            worker.stdin.write(
              JSON.stringify({
                ...message,
                file: "/data/" + path.basename(message.file),
              }) + "\n",
            );
          readline
            .createInterface({ input: worker.stdout })
            .on("line", (line) => {
              try {
                if (Buffer.byteLength(line) > 350000)
                  throw new Error("frame too large");
                worker.emit("message", JSON.parse(line));
              } catch {
                this.kill({ worker, containerName });
              }
            });
        }
        worker.stderr.resume();
        slot = { worker, job: null, containerName };
        this.workers.push(slot);
        const s = slot;
        worker.on("message", (m) => {
          if (s.dying || s.job?.id !== m.id) return;
          const job = s.job;
          clearTimeout(s.timer);
          s.job = null;
          if (m.error)
            job.reject(Object.assign(new Error(m.error.message), m.error));
          else job.resolve(m.value);
          worker.unref();
          worker.channel?.unref();
          this.drain();
        });
        worker.on("error", () => {
          s.dying = true;
          this.kill(s);
        });
        worker.on("exit", () => {
          clearTimeout(s.timer);
          this.workers = this.workers.filter((x) => x !== s);
          if (s.job)
            s.job.reject(
              Object.assign(
                new Error("Database worker đã dừng; cần đối soát transaction."),
                {
                  code:
                    Date.now() >= s.job.deadline
                      ? "RUN_TIMEOUT"
                      : "DATABASE_WORKER_LOST",
                },
              ),
            );
          s.job = null;
          this.drain();
        });
      }
      if (!slot) return;
      const job = this.queue.shift();
      if (Date.now() >= job.deadline) {
        job.reject(
          Object.assign(new Error("Hết thời gian chờ database."), {
            code: "RUN_TIMEOUT",
            definitelyNotApplied: true,
          }),
        );
        continue;
      }
      slot.job = job;
      slot.worker.ref();
      slot.worker.channel?.ref();
      slot.worker.send({ ...job, resolve: undefined, reject: undefined });
      // Process termination interrupts native queries; SQLite rolls back open transactions.
      slot.timer = setTimeout(
        () => {
          slot.dying = true;
          this.kill(slot);
        },
        Math.max(1, job.deadline - Date.now()),
      );
    }
  }
  close() {
    this.closed = true;
    for (const slot of this.workers) {
      clearTimeout(slot.timer);
      this.kill(slot);
    }
    for (const job of this.queue.splice(0))
      job.reject(new Error("Database pool đã đóng."));
  }
  kill(slot) {
    slot.worker.kill("SIGKILL");
    if (slot.containerName)
      spawn("docker", ["kill", slot.containerName], {
        stdio: "ignore",
        windowsHide: true,
      });
  }
}
module.exports = { DatabasePool };
