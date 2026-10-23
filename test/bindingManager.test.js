import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createBindingManager } from "../src/bindingManager.js";
import { createBotStore } from "../src/botStore.js";
import { trustedWeixinBase } from "../src/platforms.js";

const tick = () => new Promise((resolve) => setImmediate(resolve));
async function fixture(t, responses, extras = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-bind-"));
  const store = createBotStore(path.join(dir, "bots.json"));
  const starts = [];
  const calls = [];
  const config = { codex: { workdir: dir }, cli: { bin: "lark-cli", configDir: path.join(dir, "existing") }, runtime: { managerStateDir: dir } };
  const manager = createBindingManager(config, store, { async start(id) { starts.push(id); } }, {
    qr: async () => "data:image/png;base64,test", ...extras,
    async fetch(url, options) { calls.push({ url, options }); const value = responses.shift(); if (value instanceof Error) throw value; return { ok: true, json: async () => value }; }
  });
  t.after(async () => { manager.close(); await fs.rm(dir, { recursive: true, force: true }); });
  async function waitReady(id) {
    let value;
    for (let i = 0; i < 100; i++) { value = await manager.get(id); if (value.state !== "starting") break; await tick(); }
    return value;
  }
  return { manager, store, starts, calls, dir, waitReady };
}

test("WeCom QR binding persists credentials but never exposes them in polling responses", async (t) => {
  const f = await fixture(t, [
    { data: { scode: "private-code", auth_url: "https://work.weixin.qq.com/auth?code=one" } },
    { data: { status: "scanned" } },
    { data: { status: "success", bot_info: { botid: "bot-one", secret: "private-secret" } } }
  ]);
  const initial = f.manager.start({ platform: "wecom", name: "Team" });
  assert.equal((await f.waitReady(initial.id)).state, "waiting");
  assert.equal((await f.manager.get(initial.id, true)).state, "scanned");
  const done = await f.manager.get(initial.id, true);
  assert.equal(done.state, "connected");
  assert.equal(JSON.stringify(done).includes("private-secret"), false);
  assert.equal(JSON.stringify(done).includes("private-code"), false);
  const bot = (await f.store.list())[0];
  assert.equal(bot.platform, "wecom"); assert.equal(bot.appSecret, "private-secret");
  assert.equal(f.starts[0], bot.id);
});

test("WeCom init status keeps the QR visible and polling until confirmed", async (t) => {
  const f = await fixture(t, [
    { data: { scode: "private-code", auth_url: "https://work.weixin.qq.com/test" } },
    { data: { status: "init" } }, { data: { status: " INIT " } },
    { data: { status: "scanned" } },
    { data: { status: "success", bot_info: { botid: "confirmed", secret: "private-secret" } } }
  ]);
  const initial = f.manager.start({ platform: "wecom" });
  const ready = await f.waitReady(initial.id);
  for (let i = 0; i < 2; i++) {
    const waiting = await f.manager.get(initial.id, true);
    assert.equal(waiting.state, "waiting");
    assert.equal(waiting.qrDataUrl, ready.qrDataUrl);
    assert.equal(f.manager.isActive(), true);
    assert.equal((await f.store.list()).length, 0);
  }
  assert.equal((await f.manager.get(initial.id, true)).state, "scanned");
  assert.equal((await f.manager.get(initial.id, true)).state, "connected");
  assert.equal(f.starts.length, 1);
});

test("WeCom unknown intermediate statuses preserve QR and never imply success or denial", async (t) => {
  const f = await fixture(t, [
    { data: { scode: "code", auth_url: "https://work.weixin.qq.com/test" } },
    { data: { status: "new-platform-status" } },
    { data: { status: "scanned" } }, { data: { status: "another-intermediate" } }
  ]);
  const s = f.manager.start({ platform: "wecom" });
  const ready = await f.waitReady(s.id);
  const first = await f.manager.get(s.id, true);
  assert.equal(first.state, "waiting");
  assert.equal(first.qrDataUrl, ready.qrDataUrl);
  assert.equal(first.message.includes("拒绝"), false);
  await f.manager.get(s.id, true);
  assert.equal((await f.manager.get(s.id, true)).state, "scanned");
  assert.equal((await f.store.list()).length, 0);
  assert.equal(f.starts.length, 0);
});

test("WeCom explicit denials and errors remain terminal rather than polling forever", async (t) => {
  for (const status of ["denied", "rejected", "cancelled", "canceled", "failed", "error"]) {
    const f = await fixture(t, [
      { data: { scode: "code", auth_url: "https://work.weixin.qq.com/test" } }, { data: { status } }
    ]);
    const s = f.manager.start({ platform: "wecom" }); await f.waitReady(s.id);
    assert.equal((await f.manager.get(s.id, true)).state, "error", status);
    assert.equal(f.manager.isActive(), false);
    assert.equal((await f.store.list()).length, 0);
  }
});

test("WeCom intermediate polling stays bounded by QR expiry", async (t) => {
  let now = 1000;
  const f = await fixture(t, [
    { data: { scode: "code", auth_url: "https://work.weixin.qq.com/test" } }, { data: { status: "init" } }
  ], { now: () => now });
  const s = f.manager.start({ platform: "wecom" }); await f.waitReady(s.id);
  assert.equal((await f.manager.get(s.id, true)).state, "waiting");
  now += 301000;
  assert.equal((await f.manager.get(s.id, true)).state, "expired");
  assert.equal(f.calls.length, 2);
});

test("WeCom success without credentials cannot save a bot or report connected", async (t) => {
  const f = await fixture(t, [
    { data: { scode: "code", auth_url: "https://work.weixin.qq.com/test" } }, { data: { status: "success" } }
  ]);
  const s = f.manager.start({ platform: "wecom" }); await f.waitReady(s.id);
  await assert.rejects(f.manager.get(s.id, true), /有效机器人凭据/);
  assert.equal((await f.store.list()).length, 0);
  assert.notEqual((await f.manager.get(s.id)).state, "connected");
});

test("DingTalk registration performs nonce and device-code flow", async (t) => {
  const f = await fixture(t, [{ errcode: 0, nonce: "nonce" },
    { errcode: 0, device_code: "device", verification_uri_complete: "https://login.dingtalk.com/test", expires_in: 120 },
    { errcode: 0, status: "SUCCESS", client_id: "ding", client_secret: "ding-secret" }]);
  const s = f.manager.start({ platform: "dingtalk" }); await f.waitReady(s.id);
  assert.equal((await f.manager.get(s.id, true)).state, "connected");
  assert.equal(f.calls.length, 3);
  assert.deepEqual(JSON.parse(f.calls[1].options.body), { nonce: "nonce" });
  assert.equal((await f.store.list())[0].appId, "ding");
});

test("WeChat confirmation stores isolated endpoint and owner", async (t) => {
  const f = await fixture(t, [{ qrcode: "qr", qrcode_img_content: "https://weixin.qq.com/test" },
    { status: "confirmed", ilink_bot_id: "wx", bot_token: "wx-token", ilink_user_id: "owner", baseurl: "https://ilinkai.weixin.qq.com" }]);
  const s = f.manager.start({ platform: "weixin" }); await f.waitReady(s.id);
  const done = await f.manager.get(s.id, true);
  assert.equal(done.state, "connected");
  assert.equal((await f.store.list())[0].platformConfig.ownerId, "owner");
  assert.equal(f.calls[0].options.headers.Authorization, undefined);
});

test("cancel during an in-flight QR poll prevents a late binding", async (t) => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const f = await fixture(t, [{ data: { scode: "code", auth_url: "https://work.weixin.qq.com/test" } }, pending]);
  const s = f.manager.start({ platform: "wecom" }); await f.waitReady(s.id);
  const poll = f.manager.get(s.id, true);
  f.manager.cancel(s.id);
  release({ data: { status: "success", bot_info: { botid: "late", secret: "secret" } } });
  assert.equal((await poll).state, "cancelled");
  assert.equal((await f.store.list()).length, 0);
});

test("expired binding cannot commit and unsupported platforms are rejected", async (t) => {
  let now = 1000;
  const f = await fixture(t, [{ data: { scode: "code", auth_url: "https://work.weixin.qq.com/test" } }], { now: () => now });
  assert.throws(() => f.manager.start({ platform: "unknown" }), /不支持/);
  const s = f.manager.start({ platform: "wecom" }); await f.waitReady(s.id);
  now += 301000;
  assert.equal((await f.manager.get(s.id, true)).state, "expired");
  assert.equal(f.calls.length, 1);
});

test("rebinding an existing bot refreshes credentials without duplicating its card", async (t) => {
  const f = await fixture(t, [{ data: { scode: "code", auth_url: "https://work.weixin.qq.com/test" } },
    { data: { status: "success", bot_info: { botid: "same", secret: "new-token" } } }]);
  await f.store.save({ id: "existing", name: "Keep name", appId: "same", appSecret: "old", platform: "wecom" });
  const s = f.manager.start({ platform: "wecom" }); await f.waitReady(s.id);
  const done = await f.manager.get(s.id, true);
  assert.equal(done.botId, "existing");
  assert.equal((await f.store.list()).length, 1);
  assert.equal((await f.store.get("existing")).name, "Keep name");
  assert.equal((await f.store.get("existing")).appSecret, "new-token");
});

test("Feishu authorization uses a private CLI config directory and resolves keychain references", async (t) => {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill() {} });
  let invocation;
  const f = await fixture(t, [], { spawn(command, args, options) { invocation = { command, args, options }; return child; }, resolveSecret: async () => "resolved-secret" });
  const s = f.manager.start({ platform: "feishu" });
  for (let i = 0; i < 100 && !invocation; i++) await new Promise((resolve) => setTimeout(resolve, 5));
  const configDir = invocation.options.env.LARKSUITE_CLI_CONFIG_DIR;
  assert.equal(configDir.startsWith(f.dir), true);
  assert.equal(configDir.includes(s.id), true);
  child.stdout.write("https://accounts.feishu.cn/device?code=test\n");
  assert.equal((await f.manager.get(s.id)).state, "waiting");
  await fs.writeFile(path.join(configDir, "config.json"), JSON.stringify({ apps: [{ appId: "cli_new", appSecret: { source: "keychain", id: "appsecret:cli_new" } }] }));
  child.emit("close", 0);
  for (let i = 0; i < 100 && (await f.manager.get(s.id)).state !== "connected"; i++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal((await f.store.list())[0].appSecret, "resolved-secret");
});

test("WeChat endpoints cannot forward tokens to arbitrary hosts", () => {
  assert.equal(trustedWeixinBase(), "https://ilinkai.weixin.qq.com");
  for (const url of ["http://ilinkai.weixin.qq.com", "https://weixin.qq.com.attacker.test", "https://user:pass@weixin.qq.com", "https://weixin.qq.com:8443"]) {
    assert.throws(() => trustedWeixinBase(url), /不可信/);
  }
});
