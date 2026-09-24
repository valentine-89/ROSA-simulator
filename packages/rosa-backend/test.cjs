const { test } = require("node:test");
const assert = require("node:assert/strict");
const { IsolatePool } = require("./pool.cjs");
const C = require("./contract.cjs");
test("isolate async SDK, CPU and isolation", async () => {
  const pool = new IsolatePool({
    mode: "local",
    poolCount: 1,
    poolMemoryMb: 256,
  });
  try {
    const result = await pool.execute(
      {
        id: "a",
        source:
          'export default async (input, rosa) => { console.log("test"); return { value: await rosa.db.macro("sum", input), host: typeof process }; }',
        input: { a: 2 },
        memoryMb: 10,
        deadline: Date.now() + 10000,
        cpuLimitMs: 10000,
      },
      async () => {
        await new Promise((r) => setTimeout(r, 100));
        return 5;
      },
    );
    assert.equal(result.error, undefined);
    assert.deepEqual(result.result, { value: 5, host: "undefined" });
    assert.ok(result.cpuMs >= 0);
    assert.equal(result.logs.length, 1);
  } finally {
    pool.close();
  }
});
test("infinite loop is terminated and another isolate works", async () => {
  const pool = new IsolatePool({
    mode: "local",
    poolCount: 1,
    poolMemoryMb: 256,
  });
  try {
    const results = await Promise.all([
      pool.execute(
        {
          id: "loop",
          source: "export default () => { while(true){} }",
          input: {},
          memoryMb: 10,
          deadline: Date.now() + 1500,
          cpuLimitMs: 10000,
        },
        async () => {},
      ),
      pool.execute(
        {
          id: "normal",
          source: "export default () => ({ok:true})",
          input: {},
          memoryMb: 10,
          deadline: Date.now() + 10000,
          cpuLimitMs: 10000,
        },
        async () => {},
      ),
    ]);
    assert.ok(results[0].error);
    assert.deepEqual(results[1].result, { ok: true });
  } finally {
    pool.close();
  }
});
test("validation and authentication", () => {
  assert.equal(
    C.analyze("export default async (input, rosa) => ({x: input.x})").ok,
    true,
  );
  assert.equal(C.analyze("export default () => process.env").ok, false);
  const config = {
    externalEnabled: true,
    authType: "basic",
    username: "demo",
    keyHash: C.hash("key"),
  };
  assert.doesNotThrow(() =>
    C.authenticate(
      { authorization: "Basic " + Buffer.from("demo:key").toString("base64") },
      config,
    ),
  );
  assert.throws(() => C.authenticate({}, config));
  assert.throws(() =>
    C.validateSchema(
      {
        type: "object",
        required: ["x"],
        properties: { x: { type: "integer" } },
        additionalProperties: false,
      },
      { x: "a" },
    ),
  );
});
test("memory limit and pending promise time out without exposing host constructors", async () => {
  const pool = new IsolatePool({
    mode: "local",
    poolCount: 1,
    poolMemoryMb: 256,
  });
  try {
    const job = {
      input: {},
      memoryMb: 10,
      deadline: Date.now() + 12000,
      cpuLimitMs: 10000,
    };
    const memory = await pool.execute(
      {
        ...job,
        id: "memory",
        source:
          "export default () => { const x=[]; while(true)x.push(new Array(100000).fill(Math.random())); }",
      },
      async () => {},
    );
    assert.ok(memory.error);
    const hanging = await pool.execute(
      {
        ...job,
        id: "hanging",
        deadline: Date.now() + 500,
        source: "export default () => new Promise(() => {})",
      },
      async () => {},
    );
    assert.ok(hanging.error);
    const escaped = await pool.execute(
      {
        ...job,
        id: "escape",
        deadline: Date.now() + 10000,
        source:
          'export default (_input, rosa) => { try { return rosa.db.macro.constructor("return typeof process")(); } catch(e) { return "blocked"; } }',
      },
      async () => {},
    );
    assert.ok(
      ["undefined", "blocked"].includes(escaped.result),
      JSON.stringify(escaped),
    );
  } finally {
    pool.close();
  }
});
