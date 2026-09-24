// Separate watchdog remains responsive while SQLite blocks in native code.
const { fork } = require("node:child_process"),
  readline = require("node:readline");
const worker = fork(
  require("node:path").join(__dirname, "database-worker.cjs"),
  [],
  {
    execArgv: ["--max-old-space-size=128"],
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  },
);
let timer,
  busy = false;
const stop = () => {
  worker.kill("SIGKILL");
  process.exit(0);
};
worker.on("error", stop);
worker.on("exit", () => process.exit(1));
worker.on("message", (m) => {
  clearTimeout(timer);
  busy = false;
  process.stdout.write(JSON.stringify(m) + "\n");
});
readline
  .createInterface({ input: process.stdin })
  .on("line", (line) => {
    try {
      if (busy || Buffer.byteLength(line) > 131072) return stop();
      const job = JSON.parse(line);
      if (!Number.isFinite(job.deadline) || job.deadline > Date.now() + 3600000)
        return stop();
      busy = true;
      timer = setTimeout(stop, Math.max(1, job.deadline - Date.now()));
      worker.send(job);
    } catch {
      stop();
    }
  })
  .on("close", stop);
