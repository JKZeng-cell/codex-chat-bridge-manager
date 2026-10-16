import test from "node:test";
import assert from "node:assert/strict";

import {
  buildHelpText,
  chunkText,
  cleanCodexCliNoise,
  describeCodexEvent,
  extractCommand,
  stripBotMentions
} from "../src/utils.js";

test("stripBotMentions removes Feishu placeholders", () => {
  assert.equal(stripBotMentions("@_user_1 /codex hello"), "/codex hello");
});

test("extractCommand recognizes prefixed command", () => {
  assert.deepEqual(
    extractCommand({
      text: "/codex list files",
      chatType: "group",
      commandPrefix: "/codex",
      allowPlainTextInP2P: true
    }),
    {
      type: "codex",
      prompt: "list files"
    }
  );
});

test("extractCommand treats plain text as command in p2p when enabled", () => {
  assert.deepEqual(
    extractCommand({
      text: "summarize this folder",
      chatType: "p2p",
      commandPrefix: "/codex",
      allowPlainTextInP2P: true
    }),
    {
      type: "codex",
      prompt: "summarize this folder"
    }
  );
});

test("extractCommand recognizes whoami helper", () => {
  assert.deepEqual(
    extractCommand({
      text: "/whoami",
      chatType: "group",
      commandPrefix: "/codex",
      allowPlainTextInP2P: true
    }),
    {
      type: "whoami"
    }
  );
});

test("extractCommand recognizes lark help helper", () => {
  assert.deepEqual(
    extractCommand({
      text: "/lark-help",
      chatType: "group",
      commandPrefix: "/codex",
      allowPlainTextInP2P: true
    }),
    {
      type: "larkHelp"
    }
  );
});

test("extractCommand recognizes direct local attachment helpers", () => {
  assert.deepEqual(
    extractCommand({
      text: '/send-file "runs/report.pdf"',
      chatType: "group",
      commandPrefix: "/codex",
      allowPlainTextInP2P: true
    }),
    {
      type: "sendAttachment",
      command: "/send-file",
      attachmentType: "file",
      path: "runs/report.pdf"
    }
  );

  assert.deepEqual(
    extractCommand({
      text: "/send-image runs/chart.png",
      chatType: "group",
      commandPrefix: "/codex",
      allowPlainTextInP2P: true
    }),
    {
      type: "sendAttachment",
      command: "/send-image",
      attachmentType: "image",
      path: "runs/chart.png"
    }
  );

  assert.deepEqual(
    extractCommand({
      text: "/send-audio runs/reply.opus",
      chatType: "group",
      commandPrefix: "/codex",
      allowPlainTextInP2P: true
    }),
    {
      type: "sendAttachment",
      command: "/send-audio",
      attachmentType: "audio",
      path: "runs/reply.opus"
    }
  );

  assert.deepEqual(
    extractCommand({
      text: "/send-voice runs/reply.wav",
      chatType: "group",
      commandPrefix: "/codex",
      allowPlainTextInP2P: true
    }),
    {
      type: "sendAttachment",
      command: "/send-voice",
      attachmentType: "audio",
      path: "runs/reply.wav"
    }
  );
});

test("extractCommand reports missing attachment path for helper commands", () => {
  assert.deepEqual(
    extractCommand({
      text: "/send-local",
      chatType: "group",
      commandPrefix: "/codex",
      allowPlainTextInP2P: true
    }),
    {
      type: "invalid",
      reason: "missing-attachment-path",
      command: "/send-local"
    }
  );
});

test("cleanCodexCliNoise removes known CLI warnings", () => {
  assert.equal(
    cleanCodexCliNoise("Reading additional input from stdin...\nactual line"),
    "actual line"
  );
});

test("describeCodexEvent keeps only key milestones", () => {
  assert.equal(
    describeCodexEvent({
      type: "turn.completed"
    }),
    "正在整理最终答复"
  );

  assert.equal(
    describeCodexEvent({
      type: "item.completed",
      item: {
        type: "command_execution",
        exit_code: 0,
        aggregated_output: "done"
      }
    }),
    ""
  );
});

test("chunkText splits oversized text", () => {
  const chunks = chunkText("a".repeat(12), 5);
  assert.deepEqual(chunks, ["aaaaa", "aaaaa", "aa"]);
});

test("buildHelpText includes local attachment helper commands", () => {
  const help = buildHelpText("/codex");
  assert.match(help, /\/send-file <local path>/);
  assert.match(help, /\/send-image <local path>/);
  assert.match(help, /\/send-audio <local path>/);
  assert.match(help, /\/send-voice <local path>/);
  assert.match(help, /\/send-local <local path>/);
});
