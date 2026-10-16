import test from "node:test";
import assert from "node:assert/strict";

import { STREAMING_CARD_ELEMENT_ID } from "../src/feishuCardBuilder.js";
import { createFeishuRunReporter } from "../src/feishuReporter.js";

function createMockClient(options = {}) {
  const replies = [];
  const patches = [];
  const reactions = [];
  const cardStreams = [];
  const cardUpdates = [];
  const cardSettings = [];
  let replyCount = 0;
  let reactionCount = 0;
  let createCardCalls = 0;

  return {
    replies,
    patches,
    reactions,
    cardStreams,
    cardUpdates,
    cardSettings,
    im: {
      v1: {
        message: {
          async reply(request) {
            replies.push(request);
            replyCount += 1;
            return {
              data: {
                message_id: `msg-${replyCount}`
              }
            };
          },
          async patch(request) {
            patches.push(request);
            return { data: {} };
          }
        },
        messageReaction: {
          async create(request) {
            reactions.push({ type: "create", request });
            reactionCount += 1;
            return {
              data: {
                reaction_id: `reaction-${reactionCount}`
              }
            };
          },
          async delete(request) {
            reactions.push({ type: "delete", request });
            return { data: {} };
          }
        }
      }
    },
    cardkit: {
      v1: {
        card: {
          async create() {
            createCardCalls += 1;
            if (options.failCardKitCreate) {
              const error = new Error("cardkit create failed");
              error.code = 999001;
              throw error;
            }

            return {
              code: 0,
              data: {
                card_id: `card-${createCardCalls}`
              }
            };
          },
          async settings(request) {
            cardSettings.push(request);
            return { code: 0 };
          },
          async update(request) {
            cardUpdates.push(request);
            return { code: 0 };
          }
        },
        cardElement: {
          async content(request) {
            cardStreams.push(request);
            return { code: 0 };
          }
        }
      }
    }
  };
}

function createConfig(overrides = {}) {
  return {
    feishu: {
      attachmentsEnabled: true,
      reactionAck: "OnIt",
      reactionSuccess: "DONE",
      reactionFailure: "ERROR",
      streamingCardEnabled: true,
      cardStreamUpdateMs: 0,
      cardPatchUpdateMs: 0,
      cardContentMaxChars: 3200,
      cardReplyPreviewChars: 1000,
      cardCommandMaxItems: 6,
      progressUpdateMs: 0,
      progressMaxLines: 8,
      progressEditLimit: 15,
      progressMessageMaxChars: 1800,
      progressSummaryMaxChars: 500,
      maxReplyChars: 70,
      ...overrides
    }
  };
}

async function waitForReporterTick() {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

function parseCardJson(raw) {
  return JSON.parse(raw);
}

test("reporter streams only the latest progress and finalizes without duplicating markdown reply chunks", async () => {
  const client = createMockClient();
  const reporter = createFeishuRunReporter({
    client,
    config: createConfig(),
    context: {
      messageId: "origin-msg"
    }
  });

  await reporter.acknowledge(0);
  reporter.start();
  reporter.note("Checking project files");
  reporter.onCodexEvent({
    type: "thread.started",
    thread_id: "thread-123"
  });
  reporter.onCodexEvent({
    type: "item.started",
    item: {
      id: "cmd-1",
      type: "command_execution",
      command: "npm.cmd run feishu -- docs +search --query roadmap"
    }
  });
  reporter.onCodexEvent({
    type: "turn.started"
  });
  reporter.onCodexEvent({
    type: "item.completed",
    item: {
      id: "cmd-1",
      type: "command_execution",
      command: "npm.cmd run feishu -- docs +search --query roadmap",
      exit_code: 0,
      aggregated_output: "Found 3 related docs"
    }
  });
  reporter.onCodexEvent({
    type: "turn.completed"
  });
  reporter.onStderr("Reading additional input from stdin...\nA noisy CLI line");
  await waitForReporterTick();

  await reporter.completeSuccess({
    threadId: "thread-123",
    outputPath: "E:\\codex\\runs\\reply.message.txt",
    transcriptPath: "E:\\codex\\runs\\reply.transcript.log",
    message:
      "## Result\n\n" +
      "This is a long Feishu reply used to verify that the final result is split into multiple post messages " +
      "instead of being stuffed back into the streaming card. The card should only keep key milestones and a short preview."
  });

  assert.equal(client.replies[0].data.msg_type, "interactive");
  assert.equal(JSON.parse(client.replies[0].data.content).data.card_id, "card-1");
  assert.ok(client.cardStreams.length >= 1);
  assert.equal(client.cardSettings.length, 1);
  assert.equal(client.cardUpdates.length, 1);
  assert.equal(client.cardStreams[0].path.element_id, STREAMING_CARD_ELEMENT_ID);
  assert.ok(/^[A-Za-z][A-Za-z0-9_]{0,19}$/.test(STREAMING_CARD_ELEMENT_ID));

  const streamContent = client.cardStreams.at(-1).data.content;
  assert.match(streamContent, /\*\*执行中\*\*/);
  assert.doesNotMatch(streamContent, /执行概览|当前进展|关键节点|\| 字段 \|/);
  assert.doesNotMatch(streamContent, /正在分析请求/);
  assert.match(streamContent, /正在整理最终答复/);
  assert.ok(streamContent.length < 160);
  assert.doesNotMatch(streamContent, /Commands/);
  assert.doesNotMatch(streamContent, /Running command/i);
  assert.doesNotMatch(streamContent, /docs \+search/);
  assert.doesNotMatch(streamContent, /CLI:/);

  const finalCard = parseCardJson(client.cardUpdates[0].data.card.data);
  const finalCardText = finalCard.body.elements.map((element) => element.content).join("\n\n");
  assert.match(finalCardText, /\*\*已完成\*\* · /);
  assert.doesNotMatch(finalCardText, /执行概览|当前进展|关键节点|结果预览/);
  assert.equal(finalCard.body.elements.length, 1);
  assert.ok(finalCardText.length < 50);
  assert.doesNotMatch(finalCardText, /Command Snapshot/);
  assert.doesNotMatch(finalCardText, /docs \+search/);
  assert.doesNotMatch(finalCardText, /Output file:/);

  const postReplies = client.replies.filter((request) => request.data.msg_type === "post");
  assert.ok(postReplies.length >= 2);
});

test("reporter falls back to interactive patch cards and keeps command details out of progress updates", async () => {
  const client = createMockClient({
    failCardKitCreate: true
  });
  const reporter = createFeishuRunReporter({
    client,
    config: createConfig(),
    context: {
      messageId: "origin-msg"
    }
  });

  await reporter.acknowledge(0);
  reporter.start();
  reporter.note("Fallback path");
  reporter.onCodexEvent({
    type: "item.started",
    item: {
      id: "cmd-1",
      type: "command_execution",
      command: "npm.cmd run feishu -- base +record-upsert"
    }
  });
  await waitForReporterTick();

  assert.equal(client.replies[0].data.msg_type, "interactive");
  const fallbackCard = parseCardJson(client.replies[0].data.content);
  assert.equal(fallbackCard.schema, "2.0");
  assert.ok(client.patches.length >= 1);

  const patchedCard = parseCardJson(client.patches.at(-1).data.content);
  const patchedText = patchedCard.body.elements.map((element) => element.content).join("\n\n");
  assert.match(patchedText, /\*\*执行中\*\*/);
  assert.match(patchedText, /Fallback path/);
  assert.doesNotMatch(patchedText, /执行概览|当前进展|关键节点/);
  assert.doesNotMatch(patchedText, /Commands/);
  assert.doesNotMatch(patchedText, /record-upsert/);
});

test("reporter strips attachment control blocks and sends attachments separately", async () => {
  const client = createMockClient();
  const attachmentCalls = [];
  const reporter = createFeishuRunReporter({
    client,
    config: createConfig(),
    context: {
      messageId: "origin-msg"
    },
    attachmentHelpers: {
      extractReplyAttachments(text) {
        assert.match(text, /feishu_attachments/);
        return {
          cleanedText: "Here is the chart and the report.",
          attachments: [
            { type: "image", path: "runs/chart.png" },
            { type: "file", path: "runs/report.pdf" }
          ]
        };
      },
      resolveReplyAttachments(attachments) {
        assert.equal(attachments.length, 2);
        return [
          { type: "image", absPath: "E:\\codex\\runs\\chart.png" },
          { type: "file", absPath: "E:\\codex\\runs\\report.pdf" }
        ];
      },
      async sendReplyAttachments(payload) {
        attachmentCalls.push(payload);
      }
    }
  });

  await reporter.acknowledge(0);
  reporter.start();
  await waitForReporterTick();

  await reporter.completeSuccess({
    threadId: "thread-456",
    outputPath: "E:\\codex\\runs\\reply.message.txt",
    transcriptPath: "E:\\codex\\runs\\reply.transcript.log",
    message:
      "Here is the chart and the report.\n\n" +
      "```feishu_attachments\n" +
      "image runs/chart.png\n" +
      "file runs/report.pdf\n" +
      "```"
  });

  assert.equal(attachmentCalls.length, 1);
  assert.equal(attachmentCalls[0].messageId, "origin-msg");
  assert.equal(attachmentCalls[0].attachments.length, 2);

  const finalCard = parseCardJson(client.cardUpdates[0].data.card.data);
  const finalCardText = finalCard.body.elements.map((element) => element.content).join("\n\n");
  assert.match(finalCardText, /\*\*已完成\*\*/);
  assert.doesNotMatch(finalCardText, /feishu_attachments/);
  assert.doesNotMatch(finalCardText, /Here is the chart and the report/);

  const postReplies = client.replies.filter((request) => request.data.msg_type === "post");
  const postMarkdown = postReplies
    .map((request) => JSON.parse(request.data.content).zh_cn.content.flat().map((item) => item.text).join("\n"))
    .join("\n");
  assert.match(postMarkdown, /Here is the chart and the report/);
  assert.doesNotMatch(postMarkdown, /feishu_attachments/);
});

test("reporter failure stays compact in CardKit and interactive patch modes", async () => {
  for (const streamingCardEnabled of [true, false]) {
    const client = createMockClient();
    const reporter = createFeishuRunReporter({ client, config: createConfig({ streamingCardEnabled }), context: { messageId: "origin-msg" } });
    await reporter.acknowledge(0);
    reporter.start();
    reporter.note("Internal step that should disappear on completion");
    await reporter.completeFailure("Task execution failed.\nElapsed: 2s\n\nConnection timed out.\n" + "diagnostic ".repeat(500));
    const card = streamingCardEnabled ? parseCardJson(client.cardUpdates.at(-1).data.card.data) : parseCardJson(client.patches.at(-1).data.content);
    const text = card.body.elements.map((element) => element.content).join("\n");
    assert.match(text, /\*\*执行失败\*\*/);
    assert.match(text, /Connection timed out/);
    assert.doesNotMatch(text, /Task execution failed|Elapsed:|Internal step|关键节点|字段/);
    assert.ok(text.length < 260);
    assert.equal(client.replies.filter((reply) => reply.data.msg_type === "post").length, 0);
  }
});
