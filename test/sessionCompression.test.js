import test from "node:test";
import assert from "node:assert/strict";

import { applyCompressedContext, compressSessionRecord } from "../src/sessionCompression.js";

test("compressSessionRecord rolls thread id into archived ids and creates a summary", () => {
  const record = compressSessionRecord({
    sessionKey: "p2p:oc_123",
    chatId: "oc_123",
    chatType: "p2p",
    threadId: "thread-1",
    history: [
      {
        id: "1",
        createdAt: "2026-04-10T10:00:00.000Z",
        userPrompt: "Summarize the deployment logs",
        responseSummary: "Deployment completed with one warning."
      }
    ]
  });

  assert.equal(record.threadId, "");
  assert.deepEqual(record.archivedThreadIds, ["thread-1"]);
  assert.match(record.compressedSummary, /Summarize the deployment logs/);
});

test("applyCompressedContext prepends the summary to the next prompt", () => {
  const prompt = applyCompressedContext("Continue from the latest incident.", {
    compressedSummary: "Condensed session history:\n- Prior RCA captured"
  });

  assert.match(prompt, /Use this condensed session context/);
  assert.match(prompt, /Continue from the latest incident/);
});
