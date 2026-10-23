import test from "node:test";
import assert from "node:assert/strict";
import { createWecomResponder } from "../src/wecomReplies.js";

function fixture(options = {}) {
  const stream = [];
  const push = [];
  const errors = [];
  const frame = { headers: { req_id: "private-request" }, body: { from: { userid: "owner" } } };
  const client = {
    async replyStream(...args) { stream.push(args); return options.stream?.(...args) ?? { errcode: 0 }; },
    async sendMessage(...args) { push.push(args); return options.push?.(...args) ?? { errcode: 0 }; }
  };
  const responder = createWecomResponder(client, frame, { ...options, onError: (error) => errors.push(error.message) });
  return { stream, push, errors, responder };
}

test("WeCom closes aging streams before expiry and sends the complete final answer through an independent message", async () => {
  let now = 0;
  const f = fixture({ now: () => now, streamWindowMs: 100 });
  await f.responder.reply("received", false);
  now = 101;
  await f.responder.reply("still processing", false);
  await f.responder.reply("complete final answer", true);
  assert.equal(f.stream.length, 2);
  assert.equal(f.stream[1][3], true);
  assert.equal(f.stream[0][1], f.stream[1][1]);
  assert.deepEqual(f.push, [["owner", { msgtype: "markdown", markdown: { content: "complete final answer" } }]]);
});

test("WeCom update budget reserves a final stream frame and avoids queue saturation", async () => {
  const f = fixture({ maxUpdates: 2 });
  await f.responder.reply("received", false);
  await f.responder.reply("partial", false);
  for (let i = 0; i < 10; i++) await f.responder.reply("later " + i, false);
  await f.responder.reply("answer", true);
  assert.equal(f.stream.length, 3);
  assert.equal(f.stream.at(-1)[3], true);
  assert.equal(f.push.length, 1);
});

test("WeCom expired or failed callback acknowledgements fall back to full final delivery without exposing frame data", async () => {
  const f = fixture({ stream: () => { throw { errcode: 846604, errmsg: "private-token" }; } });
  await assert.rejects(f.responder.reply("received", false), /846604/);
  await f.responder.reply("answer", true);
  assert.equal(f.stream.length, 1);
  assert.equal(f.push[0][1].markdown.content, "answer");
  const immediate = fixture({ stream: () => ({ errcode: 846608, errmsg: "private-token" }) });
  await immediate.responder.reply("final", true);
  assert.equal(immediate.push[0][1].markdown.content, "final");
  assert.ok(immediate.errors.every((message) => !message.includes("private")));
});

test("WeCom missing SDK acknowledgements are bounded and do not trap later final delivery", async () => {
  const f = fixture({ timeoutMs: 5, stream: () => new Promise(() => {}) });
  await assert.rejects(f.responder.reply("received", false), /超时/);
  await f.responder.reply("final", true);
  assert.equal(f.push.length, 1);
});

test("WeCom rejected active delivery remains an error rather than a successful final reply", async () => {
  const f = fixture({ stream: () => ({ errcode: 846604 }), push: () => ({ errcode: 40001 }) });
  await assert.rejects(f.responder.reply("answer", true), /40001/);
});
