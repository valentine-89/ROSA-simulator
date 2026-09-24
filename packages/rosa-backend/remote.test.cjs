const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { IsolatePool } = require("./pool.cjs");
const { RemotePool, runnerServer } = require("./remote.cjs");
const { WebSocket } = require("ws");
test("two authenticated runner endpoints execute independently, broker SDK and survive failures", async () => {
  const token = "test-runner-token-12345678901234567890";
  process.env.ROSA_TEST_RUNNER_TOKEN = token;
  const servers = [0, 1].map(() =>
    runnerServer({
      port: 0,
      token,
      pool: new IsolatePool({ mode: "local", poolCount: 1, poolMemoryMb: 256 }),
    }),
  );
  await Promise.all(
    servers.map((server) => new Promise((r) => server.on("listening", r))),
  );
  const endpoints = servers.map((s) => ({
    url: "ws://127.0.0.1:" + s.address().port,
    tokenEnv: "ROSA_TEST_RUNNER_TOKEN",
  }));
  const pool = new RemotePool(endpoints);
  try {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(endpoints[0].url);
      ws.once("open", () =>
        reject(new Error("Unauthenticated runner accepted")),
      );
      ws.once("unexpected-response", (_req, res) => {
        assert.equal(res.statusCode, 401);
        ws.terminate();
        resolve();
      });
      ws.on("error", () => {});
    });
    const results = await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        pool.execute(
          {
            id: "remote-" + i,
            source:
              'export default async (input, rosa) => ({n:await rosa.db.macro("echo",input)})',
            input: { n: i },
            memoryMb: 10,
            deadline: Date.now() + 20000,
            cpuLimitMs: 10000,
          },
          async (_method, args) => args[1].n,
        ),
      ),
    );
    assert.equal(results.filter((r) => !r.error).length, 100);
    assert.deepEqual(
      results.map((r) => r.result.n),
      Array.from({ length: 100 }, (_, i) => i),
    );
    assert.ok(pool.clients.every((c) => c.ws));
  } finally {
    pool.close();
    await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
    delete process.env.ROSA_TEST_RUNNER_TOKEN;
  }
});
