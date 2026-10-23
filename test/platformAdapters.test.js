import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createPlatformAdapter } from "../src/platformAdapters.js";

async function dingFixture(options = {}) {
  let callback;
  let message;
  const requests = [];
  const errors = [];
  const client = { connected: true, registerCallbackListener(_topic, handler) { callback = handler; },
    async connect() {}, disconnect() {}, socketCallBackResponse() {} };
  const adapter = createPlatformAdapter({ bot: { platform: "dingtalk" }, feishu: { appId: "robot-one", appSecret: "private-secret", streamingCardEnabled: options.enabled !== false } }, {
    onState() {}, onError(error) { errors.push(error.message); }, async onMessage(value) { message = value; }
  }, { dingtalkFactory: () => client, async fetch(url, init) {
    requests.push({ url, method: init.method, body: JSON.parse(init.body) });
    if (options.denied && url.includes("/card/")) return { ok: false, status: 403 };
    if (options.deliveryRejected && url.endsWith("instances/deliver")) return {
      ok: true, json: async () => ({ result: [{ success: false, errorMsg: "private-token" }] })
    };
    if (options.finalStreamRejected && url.endsWith("streaming") && JSON.parse(init.body).isFinalize) return { ok: false, status: 400 };
    return { ok: true, json: async () => url.endsWith("accessToken") ? { accessToken: "private-token", expireIn: 7200 } : {} };
  } });
  await adapter.start();
  callback({ headers: { messageId: "callback-one" }, data: JSON.stringify({ msgId: "message-one", conversationType: options.group ? "2" : "1",
    senderStaffId: "owner", conversationId: "conversation-one", text: { content: "hello" }, sessionWebhook: "https://oapi.dingtalk.com/robot/send?session=private" }) });
  return { adapter, message, requests, errors };
}

test("DingTalk uses one AI card with full snapshots, ordered finalization and scoped group/private delivery", async (t) => {
  for (const group of [false, true]) {
    const f = await dingFixture({ group });
    t.after(() => f.adapter.stop());
    assert.equal(f.message.streamingMode, "replace");
    await f.message.reply("received", false);
    await f.message.reply("partial", false);
    await f.message.reply("final", true);
    const cards = f.requests.filter((request) => request.url.includes("/card/"));
    assert.deepEqual(cards.map((request) => request.method), ["POST", "POST", "PUT", "PUT", "PUT", "PUT", "PUT"]);
    assert.equal(cards[0].body.cardTemplateId, "02fcf2f4-5e02-4a85-b672-46d1f715543e.schema");
    const inputting = cards[2].body.cardData.cardParamMap;
    assert.equal(inputting.flowStatus, "2");
    assert.deepEqual(JSON.parse(inputting.sys_full_json_obj), { order: ["msgContent"] });
    assert.equal(inputting.msgContent, "received");
    assert.equal(JSON.parse(inputting.config).autoLayout, true);
    assert.equal(new Set(cards.map((request) => request.body.outTrackId)).size, 1);
    const delivery = cards[1].body;
    assert.equal(delivery.openSpaceId, "dtv1.card//" + (group ? "IM_GROUP.conversation-one" : "IM_ROBOT.owner"));
    if (group) assert.equal(delivery.imGroupOpenDeliverModel.robotCode, "robot-one");
    else assert.equal(delivery.imRobotOpenDeliverModel.robotCode, "robot-one");
    const updates = cards.filter((request) => request.url.endsWith("streaming"));
    assert.deepEqual(updates.map((request) => request.body.isFinalize), [false, false, true]);
    assert.equal(updates.every((request) => request.body.isFull), true);
    assert.equal(new Set(updates.map((request) => request.body.guid)).size, 3);
    assert.equal(cards.at(-1).body.cardData.cardParamMap.flowStatus, "3");
    assert.equal(cards.at(-1).body.cardData.cardParamMap.msgContent, "final");
    assert.deepEqual(JSON.parse(cards.at(-1).body.cardData.cardParamMap.sys_full_json_obj), { order: ["msgContent"] });
    assert.equal(f.requests.filter((request) => request.url.includes("/robot/send")).length, 0);
    assert.equal(f.errors.length, 0);
  }
});

test("DingTalk permission denial falls back once and long text remains complete UTF-8", async (t) => {
  const f = await dingFixture({ denied: true });
  t.after(() => f.adapter.stop());
  await f.message.reply("received", false);
  assert.equal(f.message.streamingMode, "append");
  const text = "答复🙂".repeat(7000);
  await f.message.reply(text);
  assert.equal(f.requests.filter((request) => request.url.includes("/card/")).length, 1);
  const texts = f.requests.filter((request) => request.url.includes("/robot/send"));
  assert.ok(texts.every((request) => request.body.msgKey === "sampleText"));
  const chunks = texts.slice(1).map((request) => JSON.parse(request.body.msgParam).content);
  assert.equal(chunks.join(""), text);
  assert.equal(chunks.every((chunk) => Buffer.byteLength(chunk) <= 16000), true);
  assert.equal(f.errors.length, 1);
  assert.equal(f.errors.join("").includes("private"), false);
});

test("DingTalk HTTP 200 with a rejected delivery falls back instead of reporting an empty card as success", async (t) => {
  const f = await dingFixture({ deliveryRejected: true });
  t.after(() => f.adapter.stop());
  await f.message.reply("answer", true);
  assert.equal(f.message.streamingMode, "append");
  assert.equal(f.requests.some((request) => request.url.endsWith("streaming")), false);
  assert.equal(JSON.parse(f.requests.at(-1).body.msgParam).content, "answer");
  assert.equal(f.errors.length, 1);
  assert.equal(f.errors.join("").includes("private-token"), false);
});

test("DingTalk still commits final visible body and status when the streaming finalizer fails", async (t) => {
  const f = await dingFixture({ finalStreamRejected: true });
  t.after(() => f.adapter.stop());
  await f.message.reply("answer", true);
  assert.equal(f.message.streamingMode, "replace");
  assert.equal(f.requests.at(-1).body.cardData.cardParamMap.msgContent, "answer");
  assert.equal(f.requests.at(-1).body.cardData.cardParamMap.flowStatus, "3");
  assert.equal(f.errors.length, 1);
});

test("DingTalk disabled streaming never tries a card and native failure uses a terminal failed state", async (t) => {
  const disabled = await dingFixture({ enabled: false });
  t.after(() => disabled.adapter.stop());
  await disabled.message.reply("answer");
  assert.equal(disabled.requests.some((request) => request.url.includes("/card/")), false);
  const enabled = await dingFixture();
  t.after(() => enabled.adapter.stop());
  await enabled.message.reply("failed", true, { failed: true });
  assert.equal(enabled.requests.find((request) => request.url.endsWith("streaming")).body.isError, true);
  assert.equal(enabled.requests.at(-1).body.cardData.cardParamMap.flowStatus, "5");
});

test("WeCom keeps one update stream per request and sends oversized final remainder without truncation", async () => {
  const writes = [];
  const pushed = [];
  let message;
  const client = Object.assign(new EventEmitter(), { connect() {}, disconnect() {}, async replyStream(...args) { writes.push(args); },
    async sendMessage(...args) { pushed.push(args); } });
  const adapter = createPlatformAdapter({ bot: { platform: "wecom" }, feishu: {} }, {
    onState() {}, onError() {}, async onMessage(value) { message = value; }
  }, { wecomFactory: () => client });
  await adapter.start();
  try {
    client.emit("message", { body: { msgid: "one", from: { userid: "owner" }, text: { content: "hello" } } });
    await message.reply("received", false);
    await message.reply("partial", false);
    const text = "中文🙂".repeat(7000);
    await message.reply(text, true);
    assert.equal(writes[0][1], writes[1][1]);
    assert.equal(writes[1][1], writes[2][1]);
    assert.equal(writes[2][2] + pushed.map((write) => write[1].markdown.content).join(""), text);
    assert.equal(writes.slice(2).every((write) => write[3] && Buffer.byteLength(write[2]) <= 16000), true);
    assert.equal(writes.length, 3);
    assert.ok(pushed.every((write) => write[0] === "owner"));
  } finally { await adapter.stop(); }
});
