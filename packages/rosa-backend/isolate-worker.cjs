"use strict";
// This process contains untrusted V8 isolates. Production runs it in a networkless container.
const ivm = require("./dependencies.cjs")("isolated-vm");
const readline = require("node:readline");
const active = new Map();
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const rpc = new Map();
let sequence = 0;
function usage(job) {
  try {
    job.cpuMs = Number(job.isolate.cpuTime) / 1e6;
  } catch {}
  return job.cpuMs || 0;
}
async function execute(message) {
  const { id, source, input, memoryMb, deadline } = message;
  if (active.has(id)) return;
  const job = {
    id,
    cpuMs: 0,
    cpuLimitMs: message.cpuLimitMs,
    deadline,
    logs: [],
    logBytes: 0,
    calls: 0,
    pending: 0,
    ended: false,
  };
  active.set(id, job);
  let result, error;
  try {
    job.isolate = new ivm.Isolate({
      memoryLimit: memoryMb,
      onCatastrophicError: () => process.exit(70),
    });
    const context = await job.isolate.createContext();
    const bridge = new ivm.Callback((method, raw) => {
      if (job.ended || Date.now() >= deadline) throw new Error("RUN_TIMEOUT");
      if (typeof raw !== "string" || Buffer.byteLength(raw) > 65536)
        throw new Error("SDK_PAYLOAD_TOO_LARGE");
      if (++job.calls > 1000 || job.pending >= 16)
        throw new Error("SDK_CALL_LIMIT");
      job.pending++;
      const op = ++sequence;
      rpc.set(op, {
        id,
        resolve: (raw) => {
          job.pending--;
          void context
            .evalClosure("globalThis.__deliver($0,$1)", [op, raw], {
              timeout: Math.max(1, deadline - Date.now()),
            })
            .catch(() => {});
        },
        reject: () => {
          job.pending--;
        },
      });
      send({ type: "sdk", id, op, method, args: JSON.parse(raw) });
      return op;
    });
    const log = new ivm.Callback((level, message) => {
      if (job.ended || job.logBytes >= 32768 || typeof message !== "string")
        return;
      const text = message.slice(0, 2048);
      job.logBytes += Buffer.byteLength(text);
      job.logs.push({ level, text, at: Date.now() });
    });
    await context.evalClosure(
      `
      const bridge=$0, log=$1, pending=new Map();
      globalThis.__deliver=(id,raw)=>{const resolve=pending.get(id);if(resolve){pending.delete(id);resolve(raw);}};
      const call=async (method,args)=>{
        const raw=JSON.stringify(args); if(raw.length>65536) throw new Error('SDK_PAYLOAD_TOO_LARGE');
        const id=bridge(method,raw);
        const response=JSON.parse(await new Promise(resolve=>pending.set(id,resolve)));
        if(response.error) throw Object.assign(new Error(response.error.message),{code:response.error.code});
        return response.value;
      };
      globalThis.rosa=Object.freeze({
        db:Object.freeze({macro:(name,params={})=>call('db.macro',[name,params]),report:(name,params={})=>call('db.report',[name,params])}),
        iot:Object.freeze({latest:alias=>call('iot.latest',[alias]),timeseries:(alias,query={})=>call('iot.timeseries',[alias,query]),command:(alias,name,params={})=>call('iot.command',[alias,name,params])})
      });
      globalThis.console=Object.freeze(Object.fromEntries(['log','warn','error'].map(level=>[level,(...args)=>{
        const text=args.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' '); log(level,text.slice(0,2048));
      }])));
    `,
      [bridge, log],
      { timeout: 1000 },
    );
    const remaining = () => Math.max(1, deadline - Date.now());
    const module = await job.isolate.compileModule(source, {
      filename: "backend.js",
    });
    await module.instantiate(context, () => {
      throw new Error("IMPORT_DISABLED");
    });
    await module.evaluate({ timeout: remaining() });
    const fn = await module.namespace.get("default", { reference: true });
    await context.global.set("__main", fn.derefInto());
    const encoded = await context.evalClosure(
      `
      return Promise.resolve(__main(JSON.parse($0),rosa)).then(value=>{
        const result=JSON.stringify(value);
        if(result===undefined) throw new Error('OUTPUT_NOT_JSON');
        if(result.length>262144) throw new Error('OUTPUT_TOO_LARGE');
        return result;
      });`,
      [JSON.stringify(input)],
      { timeout: remaining(), result: { promise: true, copy: true } },
    );
    if (Buffer.byteLength(encoded) > 262144)
      throw new Error("OUTPUT_TOO_LARGE");
    result = JSON.parse(encoded);
  } catch (e) {
    error = {
      code:
        job.stopCode ||
        (Date.now() >= deadline
          ? "RUN_TIMEOUT"
          : /memory|disposed/i.test(e.message)
            ? "MEMORY_LIMIT"
            : "EXECUTION_FAILED"),
      message: String(e.message).slice(0, 1024),
      stack: String(e.stack || "")
        .split("\n")
        .filter((x) => /backend.js/.test(x))
        .slice(0, 5)
        .join("\n"),
    };
  } finally {
    job.ended = true;
    const cpuMs = usage(job);
    for (const [op, pending] of rpc)
      if (pending.id === id) {
        rpc.delete(op);
        pending.reject(new Error("RUN_ENDED"));
      }
    try {
      job.isolate?.dispose();
    } catch {}
    active.delete(id);
    send({ type: "done", id, result, error, cpuMs, logs: job.logs });
  }
}
readline
  .createInterface({ input: process.stdin, crlfDelay: Infinity })
  .on("line", (line) => {
    try {
      if (Buffer.byteLength(line) > 600000) throw new Error("FRAME_TOO_LARGE");
      const m = JSON.parse(line);
      if (m.type === "run") void execute(m);
      if (m.type === "reply") {
        const pending = rpc.get(m.op);
        if (pending && pending.id === m.id) {
          rpc.delete(m.op);
          pending.resolve(JSON.stringify(m.payload));
        }
      }
      if (m.type === "budget") {
        const job = active.get(m.id);
        if (job) job.cpuLimitMs = m.cpuLimitMs;
      }
      if (m.type === "cancel") {
        const job = active.get(m.id);
        if (job) {
          usage(job);
          try {
            job.isolate?.dispose();
          } catch {}
        }
      }
    } catch {
      process.exit(71);
    }
  });
setInterval(() => {
  for (const job of active.values())
    send({ type: "usage", id: job.id, cpuMs: usage(job) });
}, 1000).unref();
setInterval(() => {
  for (const job of active.values()) {
    if (
      Date.now() >= job.deadline ||
      (Number.isFinite(job.cpuLimitMs) && usage(job) >= job.cpuLimitMs)
    ) {
      job.stopCode =
        Date.now() >= job.deadline ? "RUN_TIMEOUT" : "CPU_BUDGET_EXHAUSTED";
      usage(job);
      try {
        job.isolate?.dispose();
      } catch {}
    }
  }
}, 50).unref();
process.stdin.on("end", () => process.exit(0));
send({ type: "ready" });
