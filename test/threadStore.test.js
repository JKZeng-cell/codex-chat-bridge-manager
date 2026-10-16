import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fsp from "node:fs/promises";

import { buildSessionKey, createThreadStore } from "../src/threadStore.js";
import { loadConfig } from "../src/config.js";

test("buildSessionKey combines chat type and chat id", () => {
  assert.equal(buildSessionKey({ chatType: "group", chatId: "oc_123" }), "group:oc_123");
});

test("thread store persists session thread mappings", async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "codex-thread-store-"));
  const filePath = path.join(tempDir, "threads.json");
  const store = createThreadStore(filePath);

  await store.set("group:oc_123", {
    sessionKey: "group:oc_123",
    threadId: "thread-1",
    updatedAt: "2026-04-03T10:00:00.000Z"
  });

  assert.deepEqual(await store.get("group:oc_123"), {
    sessionKey: "group:oc_123",
    threadId: "thread-1",
    updatedAt: "2026-04-03T10:00:00.000Z"
  });

  await store.delete("group:oc_123");
  assert.equal(await store.get("group:oc_123"), null);
});

test("loadConfig disables ephemeral mode when session threads are enabled", () => {
  const originalValues = {
    FEISHU_APP_ID: process.env.FEISHU_APP_ID,
    FEISHU_APP_SECRET: process.env.FEISHU_APP_SECRET,
    FEISHU_SESSION_THREADS_ENABLED: process.env.FEISHU_SESSION_THREADS_ENABLED,
    CODEX_EPHEMERAL: process.env.CODEX_EPHEMERAL
  };

  try {
    process.env.FEISHU_APP_ID = "cli_test";
    process.env.FEISHU_APP_SECRET = "secret";
    process.env.FEISHU_SESSION_THREADS_ENABLED = "true";
    process.env.CODEX_EPHEMERAL = "true";

    const config = loadConfig();
    assert.equal(config.feishu.sessionThreadsEnabled, true);
    assert.equal(config.codex.ephemeral, false);
  } finally {
    for (const [key, value] of Object.entries(originalValues)) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});
