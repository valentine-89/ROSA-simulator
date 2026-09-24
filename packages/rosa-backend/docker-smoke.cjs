const assert = require("node:assert/strict"),
  { execFileSync } = require("node:child_process");
const { IsolatePool } = require("./pool.cjs");
async function main() {
  const pool = new IsolatePool({
    mode: "docker",
    poolCount: 1,
    poolMemoryMb: 256,
    cpusPerPool: 1,
  });
  let name;
  try {
    const first = pool.execute(
      {
        id: "docker-smoke",
        source:
          'export default async (input,rosa) => ({value:await rosa.db.macro("echo",input),host:typeof process})',
        input: { value: 7 },
        memoryMb: 10,
        deadline: Date.now() + 20000,
        cpuLimitMs: 10000,
      },
      async () => {
        await new Promise((r) => setTimeout(r, 1000));
        return 7;
      },
    );
    for (let i = 0; i < 100 && !pool.children.some((c) => c.ready); i++)
      await new Promise((r) => setTimeout(r, 100));
    assert.ok(pool.children[0]?.ready, "Docker runner did not become ready");
    name = pool.children[0].containerName;
    const container = JSON.parse(
        execFileSync("docker", ["inspect", name], { encoding: "utf8" }),
      )[0],
      config = container.HostConfig;
    assert.equal(config.NetworkMode, "none");
    assert.equal(config.ReadonlyRootfs, true);
    assert.equal(config.Memory, 256 * 1024 * 1024);
    assert.equal(config.MemorySwap, config.Memory);
    assert.equal(config.NanoCpus, 1e9);
    assert.equal(config.Privileged, false);
    assert.deepEqual(config.CapDrop, ["ALL"]);
    assert.ok(config.SecurityOpt.includes("no-new-privileges"));
    assert.equal(container.Config.User, "10001:10001");
    assert.equal(container.Mounts.length, 0);
    const result = await first;
    assert.equal(result.error, undefined, JSON.stringify(result));
    assert.deepEqual(result.result, { value: 7, host: "undefined" });
    assert.ok(result.cpuMs > 0);
    const all = await Promise.all(
      Array.from({ length: 1000 }, (_, i) =>
        pool.execute(
          {
            id: "load-" + i,
            source: "export default input => ({n:input.n})",
            input: { n: i },
            memoryMb: 10,
            deadline: Date.now() + 60000,
            cpuLimitMs: 10000,
          },
          async () => {},
        ),
      ),
    );
    assert.equal(all.filter((r) => !r.error).length, 1000);
    console.log(
      JSON.stringify({
        docker: true,
        runs: all.length,
        cpuMs: all.reduce((sum, r) => sum + r.cpuMs, 0),
        memoryMb: 256,
        cpus: 1,
        network: "none",
        readonly: true,
        unprivileged: true,
      }),
    );
  } finally {
    pool.close();
    if (name)
      for (let i = 0; i < 100; i++) {
        const running = execFileSync(
          "docker",
          ["ps", "-q", "--filter", "name=" + name],
          { encoding: "utf8" },
        ).trim();
        if (!running) break;
        await new Promise((r) => setTimeout(r, 100));
      }
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
