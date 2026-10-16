import test from "node:test";
import assert from "node:assert/strict";
import { buildCodexStatusCommand, createCodexStatusMonitor } from "../src/codexStatus.js";
import { formatUptime, summarizeServices, describeCodexStatus } from "../src/public/systemStatus.js";

const config = { codex: { cliMode: "local", cliBin: process.execPath, localCliPath: "/tools/codex.js" } };

test("Codex health checks use the configured CLI without executing tasks or downloading npx packages", () => {
  assert.deepEqual(buildCodexStatusCommand(config.codex, ["login", "status"]), { command: process.execPath, args: ["/tools/codex.js", "login", "status"] });
  assert.equal(buildCodexStatusCommand({ cliMode: "npx" }, ["--version"]), null);
  assert.deepEqual(buildCodexStatusCommand({ cliMode: "global", cliBin: "C:\\Tools\\codex.exe" }, ["--version"], "win32"), { command: "C:\\Tools\\codex.exe", args: ["--version"] });
  assert.equal(buildCodexStatusCommand({ cliMode: "global", cliBin: "C:\\My Tools\\codex.cmd" }, ["login", "status"], "win32").command, "cmd.exe");
  assert.throws(() => buildCodexStatusCommand({ cliMode: "global", cliBin: "codex & echo bad" }, ["--version"], "win32"));
});

test("Codex health caches checks, coalesces simultaneous refreshes and excludes raw credentials", async () => {
  let calls = 0;
  let clock = 100000;
  const monitor = createCodexStatusMonitor(config, { now: () => clock, run: async (_command, args) => {
    calls++;
    return { code: 0, output: args.includes("--version") ? "codex-cli 0.163.0" : "Logged in using an API key: private-test-value" };
  } });
  assert.equal(monitor.getStatus().checking, true);
  const first = monitor.refresh();
  assert.equal(first, monitor.refresh());
  const result = await first;
  assert.equal(result.state, "ready");
  assert.equal(result.authMode, "API Key");
  assert.equal(result.version, "0.163.0");
  assert.equal(JSON.stringify(result).includes("private-test-value"), false);
  result.state = "mutated";
  assert.equal(monitor.getStatus().state, "ready");
  assert.equal(calls, 2);
  clock += 30001;
  assert.equal(monitor.getStatus().checking, true);
  await monitor.refresh();
  assert.equal(calls, 4);
});

test("Codex health distinguishes logged-out, unavailable, timeout, unknown and npx modes", async () => {
  for (const [response, expected] of [
    [{ code: 1, output: "Not logged in" }, "unauthorized"],
    [{ code: 0, output: "unexpected response" }, "unknown"],
    [{ code: 1, output: "", timedOut: true }, "timeout"],
    [{ code: 0, output: "Logged in using ChatGPT" }, "ready"]
  ]) {
    const monitor = createCodexStatusMonitor(config, { run: async (_command, args) => args.includes("--version") ? { code: 0, output: "codex-cli 1.2.3" } : response });
    assert.equal((await monitor.refresh()).state, expected);
  }
  const unavailable = createCodexStatusMonitor(config, { run: async () => ({ code: "ENOENT", output: "" }) });
  assert.equal((await unavailable.refresh()).state, "unavailable");
  const broken = createCodexStatusMonitor(config, { run: async () => { throw new Error("private details"); } });
  assert.equal((await broken.refresh()).state, "unknown");
  const npx = createCodexStatusMonitor({ codex: { cliMode: "npx" } }, { run: () => assert.fail("npx must not be run") });
  assert.equal((await npx.refresh()).state, "unchecked");
});

test("system health summarizes all bot queues and never equates local login with network connectivity", () => {
  assert.deepEqual(summarizeServices(), { total: 0, running: 0, errors: 0, active: 0, pending: 0 });
  assert.deepEqual(summarizeServices([
    { service: { state: "running", queue: { activeCount: 2, pendingCount: 3 } } },
    { service: { state: "error", queue: { activeCount: 0, pendingCount: 1 } } },
    { service: { state: "stopped" } }
  ]), { total: 3, running: 1, errors: 1, active: 2, pending: 4 });
  assert.equal(formatUptime(90061000), "1 天 1 小时");
  assert.equal(formatUptime(3661000), "1 小时 1 分钟");
  assert.equal(formatUptime(61000), "1 分钟 1 秒");
  assert.equal(formatUptime(-1000), "0 秒");
  assert.equal(describeCodexStatus({ checking: true }).label, "检测中");
  assert.equal(describeCodexStatus({ state: "ready" }).hint.includes("以实际任务为准"), true);
  assert.equal(describeCodexStatus({}).label, "等待检测");
});
