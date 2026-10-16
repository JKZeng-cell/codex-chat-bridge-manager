import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createMaintenanceManager } from "../src/maintenanceManager.js";

function fixture() {
  const children = [];
  const manager = createMaintenanceManager({ cli: { bin: "lark-cli", configDir: "test-config" } }, {
    spawn(command, args) {
      const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), command, args });
      children.push(child); return child;
    }
  });
  return { manager, children };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
test("maintenance uses the official updater and prevents simultaneous installs", async () => {
  const { manager, children } = fixture();
  assert.throws(() => manager.start("arbitrary-command"), /不支持/);
  assert.equal(manager.start("check").state, "running");
  assert.throws(() => manager.start("update"), /正在执行/);
  assert.equal(children[0].args.join(" ").includes("--check"), true);
  children[0].stdout.write(JSON.stringify({ ok: true, action: "update_available", current_version: "1", latest_version: "2" }));
  children[0].emit("close", 0);
  await tick();
  assert.equal(manager.getStatus().state, "completed");
  manager.start("skills");
  assert.equal(children[1].args.join(" ").includes("--force"), true);
  children[1].stdout.write(JSON.stringify({ ok: true, action: "updated" }));
  children[1].emit("close", 0);
  await tick();
  assert.equal(manager.getStatus().state, "running");
  children[2].stdout.write(JSON.stringify({ ok: true, current_version: "2", latest_version: "2", skills_status: { in_sync: true } }));
  children[2].emit("close", 0);
  await tick();
  assert.equal(manager.getStatus().state, "completed");
});
test("failed, missing, or manual updater results are never reported as success", async () => {
  for (const [code, result] of [[1, { ok: false }], [0, null], [0, { ok: true, action: "manual_install" }]]) {
    const { manager, children } = fixture();
    manager.start("update");
    if (result) children[0].stdout.write(JSON.stringify(result));
    children[0].emit("close", code);
    await tick();
    assert.equal(manager.getStatus().state, "error");
  }
});
test("updates verify the installed version and do not hide incomplete skill synchronization", async () => {
  for (const status of [{ current_version: "1", latest_version: "2" }, { current_version: "2", latest_version: "2", skills_status: { in_sync: false } }]) {
    const { manager, children } = fixture();
    manager.start("update");
    children[0].stdout.write(JSON.stringify({ ok: true, action: "updated" })); children[0].emit("close", 0);
    await tick();
    children[1].stdout.write(JSON.stringify({ ok: true, ...status })); children[1].emit("close", 0);
    await tick();
    assert.equal(manager.getStatus().state, "error");
  }
});
