import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createPlatformCliManager } from "../src/platformCliManager.js";

const pause = () => new Promise((resolve) => setTimeout(resolve, 10));
async function fixture(t, options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "platform-cli-"));
  const calls = [];
  const authorized = new Set();
  const children = [];
  const manager = createPlatformCliManager({ runtime: { botsStateDir: dir } }, {
    authorizationTimeoutMs: options.timeout || 1000,
    resolve: () => options.missing ? "" : "native-cli",
    spawn(binary, args, settings) {
      calls.push({ binary, args, settings });
      const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(),
        killed: false, kill() { this.killed = true; queueMicrotask(() => this.emit("close", 1)); } });
      const platform = settings.env.WECOM_CLI_CONFIG_DIR === settings.cwd ? "wecom" : "dingtalk";
      const version = args.includes("--version") || args[0] === "version";
      const status = args.includes("show") || args.includes("status");
      if (version || status) queueMicrotask(() => {
        child.stdout.write(version ? (options.legacy ? "0.1.9" : platform === "wecom" ? "wecom-cli 1.2.1" : "dws 1.0.65")
          : platform === "wecom" ? authorized.has(settings.cwd) ? "authorized\n" : "unauthorized\n"
            : JSON.stringify({ authenticated: authorized.has(settings.cwd), access_token: "never-expose-this-token",
              ...(options.uninitialized && !authorized.has(settings.cwd) ? { reason: "local_state_requires_repair" } : {}) }));
        child.emit("close", 0);
      });
      else { children.push(child); child.directory = settings.cwd; }
      return child;
    }
  });
  t.after(async () => { manager.close(); await fs.rm(dir, { recursive: true, force: true }); });
  return { manager, calls, authorized, children, bot: { id: "one", platform: "wecom" } };
}

test("CLI manager detects missing and legacy tools without starting authorization", async (t) => {
  for (const options of [{ missing: true }, { legacy: true }]) {
    const f = await fixture(t, options);
    const result = await f.manager.startAuthorization(f.bot);
    assert.equal(result.authTask.running, false);
    assert.equal(result.authTask.status, "failed");
    assert.equal(f.children.length, 0);
    assert.equal(f.calls.some((call) => call.args.includes("show")), false);
  }
});

test("CLI authorization uses native scoped processes and confirms saved auth before reporting success", async (t) => {
  const f = await fixture(t);
  for (const platform of ["wecom", "dingtalk"]) {
    const bot = { ...f.bot, platform, id: platform };
    const starting = await f.manager.startAuthorization(bot);
    assert.equal(starting.authTask.running, true);
    const child = f.children.at(-1);
    const call = f.calls.at(-1);
    assert.equal(call.settings.windowsHide, true);
    assert.equal(call.settings.shell, undefined);
    assert.equal(call.settings.env[platform === "wecom" ? "WECOM_CLI_CONFIG_DIR" : "DWS_CONFIG_DIR"], call.settings.cwd);
    child.stdout.write("device_code=never-expose-this-code\nhttps://attacker.test/auth\n");
    if (platform === "wecom") {
      assert.ok(call.args.includes("--output-qrcode"));
      const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
      await fs.writeFile(call.args.at(-1), png);
      assert.match((await f.manager.getStatus(bot)).authTask.qrDataUrl, /^data:image\/png;base64,/);
    } else {
      assert.ok(call.args.includes("--device"));
      child.stderr.write("https://login.dingtalk.com/oauth2/device?user_code=public-code\n");
      for (let i = 0; i < 50 && !(await f.manager.getStatus(bot)).authTask.qrDataUrl; i++) await pause();
      const status = await f.manager.getStatus(bot);
      assert.match(status.authTask.qrDataUrl, /^data:image\/png;base64,/);
      assert.equal(status.authTask.verificationUrl, "https://login.dingtalk.com/oauth2/device?user_code=public-code");
    }
    f.authorized.add(child.directory);
    child.emit("close", 0);
    for (let i = 0; i < 50 && (await f.manager.getStatus(bot)).authTask.status !== "authorized"; i++) await pause();
    const result = await f.manager.getStatus(bot);
    assert.equal(result.authTask.status, "authorized");
    assert.equal(result.authorized, true);
    assert.equal(result.authTask.qrDataUrl, "");
    assert.equal(JSON.stringify(result).includes("never-expose"), false);
    f.authorized.delete(child.directory);
    const changed = await f.manager.getStatus(bot, true);
    assert.equal(changed.authorized, false);
    assert.notEqual(changed.authTask.status, "authorized");
  }
});

test("zero exit without actual authorization is not success, and status caching avoids repeated polling", async (t) => {
  const f = await fixture(t);
  await f.manager.startAuthorization(f.bot);
  f.children[0].emit("close", 0);
  for (let i = 0; i < 50 && (await f.manager.getStatus(f.bot)).authTask.status !== "failed"; i++) await pause();
  assert.equal((await f.manager.getStatus(f.bot)).authTask.status, "failed");
  const count = f.calls.length;
  await f.manager.getStatus(f.bot); await f.manager.getStatus(f.bot);
  assert.equal(f.calls.length, count);
});

test("fresh DingTalk profiles can initialize even when readonly status reports migration/repair needed", async (t) => {
  const f = await fixture(t, { uninitialized: true });
  const bot = { ...f.bot, platform: "dingtalk" };
  const initial = await f.manager.getStatus(bot);
  assert.equal(initial.state, "unknown");
  assert.equal(initial.authorized, false);
  assert.equal(initial.supported, true);
  const result = await f.manager.startAuthorization(bot);
  assert.equal(result.authTask.running, true);
  assert.equal(f.children.length, 1);
  await f.manager.cancelAuthorization(bot);
});

test("cancel affects only its owned auth process and cannot be undone by a late successful exit", async (t) => {
  const f = await fixture(t);
  const other = { ...f.bot, id: "two" };
  await f.manager.startAuthorization(f.bot);
  await f.manager.startAuthorization(other);
  assert.equal(f.manager.isActive(), true);
  const [first, second] = f.children;
  await f.manager.cancelAuthorization(f.bot);
  f.authorized.add(first.directory); first.emit("close", 0); await pause();
  assert.equal((await f.manager.getStatus(f.bot)).authTask.status, "cancelled");
  assert.equal(first.killed, true);
  assert.equal(second.killed, false);
  assert.equal(f.manager.isActive(other.id), true);
  f.manager.close();
  assert.equal(second.killed, true);
});

test("authorization expires and double starts reuse the same owned process", async (t) => {
  const f = await fixture(t, { timeout: 40 });
  await Promise.all([f.manager.startAuthorization(f.bot), f.manager.startAuthorization(f.bot)]);
  assert.equal(f.children.length, 1);
  for (let i = 0; i < 50 && f.manager.isActive(); i++) await pause();
  const result = await f.manager.getStatus(f.bot);
  assert.equal(result.authTask.status, "expired");
  assert.equal(f.children[0].killed, true);
});
