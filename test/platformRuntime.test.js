import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { loadManagerConfig, buildRuntimeConfigFromBot } from "../src/config.js";
import { createPlatformRuntime } from "../src/platformRuntime.js";
import { createThreadStore } from "../src/threadStore.js";
import { createBotStore } from "../src/botStore.js";
import { compressSessionRecord } from "../src/sessionCompression.js";
import { createPlatformAdapter } from "../src/platformAdapters.js";
import { EventEmitter } from "node:events";

async function fixture(t, runner) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "platform-runtime-"));
  t.after(async () => { await fs.rm(dir, { recursive: true, force: true }); });
  const managerConfig = loadManagerConfig();
  managerConfig.runtime.botsStateDir = dir;
  const config = buildRuntimeConfigFromBot({ id: "wecom-test", platform: "wecom", name: "Team", appId: "app", appSecret: "secret", maxConcurrentJobs: 2 }, managerConfig);
  const store = createThreadStore(config.runtime.sessionThreadStorePath);
  let handlers;
  const runtime = createPlatformRuntime(config, { runner, store, adapterFactory(_config, hooks) {
    handlers = hooks;
    return { async start() { hooks.onState("running"); }, async stop() {} };
  } });
  const replies = [];
  const message = (id, text, chatId = "chat-one") => ({ id, text, chatId, userId: "owner", chatType: "p2p", async reply(content, finish) { replies.push({ content, finish }); } });
  async function drain() {
    for (let i = 0; i < 200; i++) {
      const queue = runtime.getStatus().queue;
      if (!queue.activeCount && !queue.pendingCount) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("Queue did not drain");
  }
  await runtime.start();
  return { config, store, runtime, handlers, replies, message, drain, dir };
}

test("new platform runtime deduplicates messages, resumes per-chat threads, and stores readable history", async (t) => {
  const calls = [];
  const f = await fixture(t, { async run(input) { calls.push(input); return { message: "answer", threadId: "thread-1", durationMs: 1 }; } });
  await f.handlers.onMessage(f.message("one", "first")); await f.drain();
  await f.handlers.onMessage(f.message("one", "first"));
  await f.handlers.onMessage(f.message("two", "/codex second")); await f.drain();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].resumeSessionId, "thread-1");
  assert.equal(calls[1].prompt, "second");
  const record = await f.store.get("p2p:chat-one");
  assert.equal(record.history.length, 2);
  assert.equal(record.history[1].responseText, "answer");
  await f.runtime.stop();
});

test("same-chat jobs serialize while different chats may run concurrently", async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = [];
  const f = await fixture(t, { async run(input) { started.push(input.prompt); if (input.prompt === "first") await gate; return { message: input.prompt, threadId: input.prompt }; } });
  await f.handlers.onMessage(f.message("one", "first"));
  await f.handlers.onMessage(f.message("two", "second"));
  await f.handlers.onMessage(f.message("three", "other", "chat-two"));
  for (let i = 0; i < 100 && !started.includes("other"); i++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(started.sort(), ["first", "other"]);
  await assert.rejects(f.runtime.stop(), /任务/);
  release(); await f.drain();
  assert.equal(started.includes("second"), true);
  await f.runtime.stop();
});

test("compressed context and selected skills are supplied on the next platform message", async (t) => {
  const calls = [];
  const f = await fixture(t, { async run(input) { calls.push(input); return { message: "answer", threadId: "thread" }; } });
  f.config.bot.preferredSkills = ["C:/skills/test/SKILL.md"];
  await f.handlers.onMessage(f.message("one", "prior request")); await f.drain();
  await f.store.update("p2p:chat-one", (record) => compressSessionRecord(record));
  await f.handlers.onMessage(f.message("two", "continue")); await f.drain();
  assert.equal(calls[1].resumeSessionId, "");
  assert.match(calls[1].prompt, /prior request/);
  assert.match(calls[1].prompt, /C:\/skills\/test\/SKILL.md/);
  await f.runtime.stop();
});

test("group prefix and allowlists protect local command execution", async (t) => {
  let count = 0;
  const f = await fixture(t, { async run() { count++; return { message: "ok" }; } });
  await f.handlers.onMessage({ ...f.message("one", "unprefixed"), chatType: "group" });
  f.config.feishu.allowedOpenIds = new Set(["allowed"]);
  await f.handlers.onMessage(f.message("two", "not allowed"));
  await f.drain(); assert.equal(count, 0);
  await f.runtime.stop();
});

test("execution failure is stored and replied without marking transport offline", async (t) => {
  const f = await fixture(t, { async run() { throw new Error("execution failed"); } });
  await f.handlers.onMessage(f.message("one", "test")); await f.drain();
  assert.equal((await f.store.get("p2p:chat-one")).history[0].status, "failed");
  assert.match(f.replies.at(-1).content, /execution failed/);
  assert.equal(f.runtime.getStatus().state, "running");
  await f.runtime.stop();
});

test("platform records retain existing Feishu defaults and validate safe storage IDs", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "platform-store-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = createBotStore(path.join(dir, "bots.json"));
  const bot = await store.save({ name: "Legacy", appId: "app", appSecret: "secret" });
  assert.equal(bot.platform, "feishu");
  await assert.rejects(store.save({ id: "../escape", name: "Bad", appId: "x", appSecret: "x" }), /标识/);
  await assert.rejects(store.save({ platform: "weixin", appId: "wx", appSecret: "secret", platformConfig: { baseUrl: "https://evil.test" } }), /不可信/);
});

test("WeCom adapter only reports running after authentication and forwards replies through SDK", async () => {
  const client = Object.assign(new EventEmitter(), { connect() {}, disconnect() {}, async replyStream(...args) { client.replied = args; } });
  const states = [];
  let message;
  const adapter = createPlatformAdapter({ bot: { platform: "wecom" }, feishu: { appId: "app", appSecret: "secret" } }, {
    onState: (value) => states.push(value), onError() {}, async onMessage(value) { message = value; }
  }, { wecomFactory: () => client });
  await adapter.start();
  assert.deepEqual(states, []);
  client.emit("authenticated"); assert.deepEqual(states, ["running"]);
  client.emit("message", { body: { msgid: "one", text: { content: "hello" }, from: { userid: "owner" } } });
  await message.reply("answer");
  assert.equal(client.replied[2], "answer");
  assert.equal(client.replied[3], true);
  await adapter.stop();
});

test("DingTalk adapter acknowledges callbacks and rejects untrusted reply webhooks", async () => {
  let callback;
  let message;
  let requests = 0;
  let acknowledgements = 0;
  const client = { connected: true, registerCallbackListener(_topic, handler) { callback = handler; },
    async connect() {}, disconnect() {}, socketCallBackResponse() { acknowledgements++; } };
  const adapter = createPlatformAdapter({ bot: { platform: "dingtalk" }, feishu: { appId: "app", appSecret: "secret" } }, {
    onState() {}, onError() {}, async onMessage(value) { message = value; }
  }, { dingtalkFactory: () => client, async fetch() { requests++; throw new Error("Unexpected request"); } });
  await adapter.start();
  callback({ headers: { messageId: "callback" }, data: JSON.stringify({ msgId: "one", senderId: "owner", text: { content: "hello" }, sessionWebhook: "https://attacker.test/reply" }) });
  assert.equal(acknowledgements, 1);
  assert.equal(message.text, "hello");
  await assert.rejects(message.reply("answer"), /不可信/);
  assert.equal(requests, 0);
  await adapter.stop();
});

test("WeChat adapter receives messages, sends context-bound replies and persists its own cursor", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "weixin-adapter-"));
  const requests = [];
  let messages = 0;
  let updates = 0;
  const adapter = createPlatformAdapter({ bot: { platform: "weixin", platformConfig: {} }, feishu: { appSecret: "test-token" },
    runtime: { sessionThreadStorePath: path.join(dir, "sessions.json") } }, {
    onState() {}, onError(error) { throw error; }, async onMessage(message) { messages++; await message.reply("answer"); }
  }, { async fetch(url, options) {
    requests.push({ url, options });
    const value = url.endsWith("getupdates") ? { get_updates_buf: "cursor-one", msgs: updates++ === 0 ? [{
      message_type: 1, message_id: "one", from_user_id: "owner", context_token: "context", item_list: [{ type: 1, text_item: { text: "hello" } }]
    }] : [] } : { errcode: 0 };
    return { ok: true, json: async () => value };
  } });
  t.after(async () => { await adapter.stop(); await fs.rm(dir, { recursive: true, force: true }); });
  await adapter.start();
  for (let i = 0; i < 100 && !requests.some((request) => request.url.endsWith("sendmessage")); i++) await new Promise((resolve) => setTimeout(resolve, 5));
  await adapter.stop();
  assert.equal(messages, 1);
  const sent = requests.find((request) => request.url.endsWith("sendmessage"));
  assert.equal(sent.options.headers.Authorization, "Bearer test-token");
  const body = JSON.parse(sent.options.body);
  assert.equal(body.msg.context_token, "context");
  assert.equal(body.msg.item_list[0].text_item.text, "answer");
  assert.equal(JSON.parse(await fs.readFile(path.join(dir, "weixin-cursor.json"), "utf8")).cursor, "cursor-one");
});
