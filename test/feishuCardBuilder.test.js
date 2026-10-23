import test from "node:test";
import assert from "node:assert/strict";
import { buildInitialStreamingCard, buildStreamingCardContent, buildFinalCard, buildFailureCard, STREAMING_CARD_ELEMENT_ID } from "../src/feishuCardBuilder.js";

const state = { statusText: "Running", startedAt: Date.now() - 2000,
  progressLines: ["先前进展", "最新进展"] };
const textOf = (card) => card.body.elements.map((element) => element.content).join("\n");

test("initial and queued cards keep valid streaming metadata with compact Chinese status", () => {
  const card = buildInitialStreamingCard();
  assert.equal(card.schema, "2.0");
  assert.equal(card.config.streaming_mode, true);
  assert.equal(card.body.elements[0].element_id, STREAMING_CARD_ELEMENT_ID);
  assert.match(textOf(card), /\*\*已接收\*\*/);
  assert.match(buildStreamingCardContent({ ...state, statusText: "Queued (3 ahead)", progressLines: ["前方还有 3 个任务"] }), /\*\*排队中\*\*.*\n\n前方还有 3 个任务/);
});

test("progress shows only the latest focus and final card never duplicates the answer", () => {
  const progress = buildStreamingCardContent(state);
  assert.match(progress, /最新进展/);
  assert.doesNotMatch(progress, /先前进展|字段|摘要|关键节点/);
  const final = buildFinalCard(state, { message: "Full answer stays in the separate reply" });
  assert.match(textOf(final), /^\*\*已完成\*\* · /);
  assert.doesNotMatch(textOf(final), /Full answer/);
  assert.equal(final.body.elements.length, 1);
});

test("streaming card includes bounded public answer snapshots in addition to compact status", () => {
  const progress = buildStreamingCardContent({ ...state, answerText: "Public answer ".repeat(500) }, { maxChars: 1000 });
  assert.match(progress, /Public answer/);
  assert.ok(progress.length <= 1000);
});

test("failure card strips repeated execution headers and bounds error output", () => {
  const card = buildFailureCard(state, "Task execution failed.\nElapsed: 2s\n\nNetwork connection failed.\n" + "details ".repeat(1000));
  const content = textOf(card);
  assert.match(content, /执行失败/);
  assert.match(content, /Network connection failed/);
  assert.match(content, /会话记录/);
  assert.doesNotMatch(content, /Task execution failed|Elapsed:|先前进展|最新进展/);
  assert.ok(content.length < 260);
});

test("failure card prioritizes terminal errors over MCP noise", () => {
  const errorText = "MCP initialization warning\n" + JSON.stringify({ type: "turn.failed", error: { message: JSON.stringify({ error: { message: "The 'unavailable-model' model is not supported when using Codex with a ChatGPT account." } }) } });
  const content = textOf(buildFailureCard(state, errorText));
  assert.match(content, /当前账号不支持模型「unavailable-model」/);
  assert.doesNotMatch(content, /MCP|turn.failed|ChatGPT account/);
});
