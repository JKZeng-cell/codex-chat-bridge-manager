import test from "node:test";
import assert from "node:assert/strict";
import { createShutdownCoordinator } from "../electron/shutdown.js";

function setup(overrides = {}) {
  const calls = [];
  const coordinator = createShutdownCoordinator({
    inspect: async () => ({ busy: false }),
    stop: async () => { calls.push("stop"); },
    exit: (code) => calls.push("exit:" + code),
    onBlocked: async () => { calls.push("busy"); },
    onInspectionError: async () => { calls.push("inspect-error"); },
    onStopError: () => calls.push("stop-error"),
    timeoutMs: 20,
    ...overrides
  });
  return { coordinator, calls };
}

test("desktop quit closes services once and coalesces repeated close requests", async () => {
  const { coordinator, calls } = setup();
  const pending = coordinator.request();
  assert.equal(coordinator.request(), pending);
  await pending;
  assert.deepEqual(calls, ["stop", "exit:0"]);
});

test("desktop quit preserves active jobs and can be retried after they finish", async () => {
  let busy = true;
  const { coordinator, calls } = setup({ inspect: async () => ({ busy }) });
  await coordinator.request();
  assert.deepEqual(calls, ["busy"]);
  busy = false;
  await coordinator.request();
  assert.deepEqual(calls, ["busy", "stop", "exit:0"]);
});

test("unknown or stalled task inspection never forces application shutdown", async () => {
  for (const inspect of [async () => { throw new Error("unavailable"); }, () => new Promise(() => {})]) {
    const { coordinator, calls } = setup({ inspect });
    await coordinator.request();
    assert.deepEqual(calls, ["inspect-error"]);
  }
});

test("idle cleanup failure or timeout exits instead of leaving an invisible process", async () => {
  for (const stop of [async () => { throw new Error("cleanup failed"); }, () => new Promise(() => {})]) {
    const { coordinator, calls } = setup({ stop });
    await coordinator.request();
    assert.deepEqual(calls, ["stop-error", "exit:1"]);
  }
});
