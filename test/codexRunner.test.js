import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createCodexRunner } from "../src/codexRunner.js";

async function fixture(t, scenario) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-completion-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = { codex: { cliMode: "local", cliBin: process.execPath, localCliPath: path.resolve("test/fixtures/codex-process.mjs"),
    workdir: root, addDirs: [], extraArgs: ["--fixture-scenario", scenario], timeoutMs: scenario === "no-terminal" ? 500 : 5000 },
    runtime: { logDir: root } };
  return createCodexRunner(config, { completionGraceMs: 40 });
}

test("Codex completed turns return the public answer without waiting for hung process teardown", async (t) => {
  const runner = await fixture(t, "complete-hang");
  const started = Date.now();
  const result = await runner.run({ prompt: "fixture", messageId: "one" });
  assert.equal(result.message, "最终答复：中文🙂");
  assert.equal(result.threadId, "fixture-thread");
  assert.equal(result.terminalEvent, "turn.completed");
  assert.equal(result.cleanupRequested, true);
  assert.ok(Date.now() - started < 4000);
});

test("Codex can use a completed public event when the output file is absent and UTF-8 arrives in split buffers", async (t) => {
  const events = [];
  const runner = await fixture(t, "split-utf8");
  const result = await runner.run({ prompt: "fixture", messageId: "one", onEvent: (event) => events.push(event) });
  assert.equal(result.message, "最终答复：中文🙂");
  assert.equal(result.message.includes("private reasoning"), false);
  assert.equal(events.find((event) => event.item?.type === "agent_message").item.text, result.message);
});

test("Codex never treats a partial public message or failed turn as successful completion", async (t) => {
  const partial = await fixture(t, "no-terminal");
  await assert.rejects(partial.run({ prompt: "fixture", messageId: "partial" }), /timed out/);
  const failed = await fixture(t, "failed");
  await assert.rejects(failed.run({ prompt: "fixture", messageId: "failed" }), (error) => error.details.terminalEvent === "turn.failed");
});

test("Codex normal process exits and legacy output-file completion remain supported", async (t) => {
  for (const scenario of ["normal", "legacy"]) {
    const runner = await fixture(t, scenario);
    const result = await runner.run({ prompt: "fixture", messageId: scenario });
    assert.equal(result.message, "最终答复：中文🙂");
    assert.equal(result.cleanupRequested, false);
  }
});
