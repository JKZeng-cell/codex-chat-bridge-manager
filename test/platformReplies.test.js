import test from "node:test";
import assert from "node:assert/strict";
import { createPlatformReplies, splitReply } from "../src/platformReplies.js";

const pause = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
const event = (text, type = "item.updated", id = "answer") => ({ type, item: { id, type: "agent_message", text } });

test("native streams replace snapshots, serialize writes and cannot overwrite the terminal reply", async () => {
  const writes = [];
  let active = 0;
  const replies = createPlatformReplies({ streamingMode: "replace", async reply(text, finish) {
    assert.equal(active++, 0); await pause(3); writes.push({ text, finish }); active--;
  } }, { intervalMs: 5 });
  await replies.acknowledge(false);
  for (let i = 0; i < 10; i++) replies.onEvent(event("partial " + i));
  replies.onEvent({ type: "item.completed", item: { type: "reasoning", text: "private reasoning" } });
  replies.onEvent({ type: "item.completed", item: { type: "command_execution", text: "private command" } });
  await pause();
  await replies.finish("final answer");
  replies.onEvent(event("late overwrite"));
  await pause();
  assert.deepEqual(writes, [{ text: "收到，正在处理…", finish: false }, { text: "partial 9", finish: false }, { text: "final answer", finish: true }]);
});

test("append transports only send stable segments once and suppress an identical final reply", async () => {
  const writes = [];
  const replies = createPlatformReplies({ streamingMode: "append", async reply(text) { writes.push(text); } }, { intervalMs: 2 });
  await replies.acknowledge(true);
  replies.onEvent(event("mutable")); await pause();
  assert.equal(writes.length, 1);
  replies.onEvent(event("first", "item.completed", "one")); await pause();
  replies.onEvent(event("first", "item.completed", "one"));
  replies.onEvent(event("second", "item.completed", "two")); await pause();
  await replies.finish("first\n\nsecond");
  assert.deepEqual(writes, ["收到，已加入队列，稍后处理。", "first", "second"]);
});

test("append streams send only final remainder or an explicitly corrected final answer", async () => {
  for (const [final, expected] of [["first\n\nsecond", "second"], ["replacement", "最终回复：\nreplacement"]]) {
    const writes = [];
    const replies = createPlatformReplies({ streamingMode: "append", async reply(text) { writes.push(text); } }, { intervalMs: 1 });
    replies.onEvent(event("first", "item.completed")); await pause();
    await replies.finish(final);
    assert.deepEqual(writes, ["first", expected]);
  }
});

test("disabled streaming still acknowledges and delivers a terminal response", async () => {
  const writes = [];
  const replies = createPlatformReplies({ streamingMode: "replace", async reply(text, finish) { writes.push({ text, finish }); } }, { enabled: false, intervalMs: 1 });
  await replies.acknowledge(false);
  replies.onEvent(event("not sent")); await pause();
  await replies.finish("failure", true);
  assert.deepEqual(writes, [{ text: "收到，正在处理…", finish: false }, { text: "failure", finish: true }]);
});

test("intermediate transport errors do not poison the final reply and are reported", async () => {
  let failed = true;
  const errors = [];
  const writes = [];
  const replies = createPlatformReplies({ streamingMode: "replace", async reply(text) {
    if (failed) { failed = false; throw new Error("delivery failed"); } writes.push(text);
  } }, { intervalMs: 1, onError: (error) => errors.push(error.message) });
  replies.onEvent(event("partial")); await pause();
  await replies.finish("final");
  assert.deepEqual(errors, ["delivery failed"]);
  assert.deepEqual(writes, ["final"]);
});

test("UTF-8 chunking keeps Unicode intact without silently losing long responses", () => {
  const text = "中文🙂é\n".repeat(12000);
  for (const limit of [1800, 16000]) {
    const chunks = splitReply(text, limit);
    assert.equal(chunks.join(""), text);
    assert.equal(chunks.every((chunk) => Buffer.byteLength(chunk) <= limit), true);
    assert.equal(chunks.some((chunk) => chunk.includes("�")), false);
  }
});
