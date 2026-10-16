import test from "node:test";
import assert from "node:assert/strict";
import { getCodexFailureMessage } from "../src/codexErrors.js";

test("model rejection is extracted from nested JSON instead of MCP authentication noise", () => {
  const message = "The 'gpt-6.1' model is not supported when using Codex with a ChatGPT account.";
  const nested = JSON.stringify({ error: { message } });
  const stdoutTail = [
    JSON.stringify({ type: "error", message: "an earlier warning" }),
    JSON.stringify({ type: "turn.failed", error: { message: nested } })
  ].join("\n");
  assert.equal(getCodexFailureMessage({ stdoutTail, stderrTail: "MCP server: Auth required" }), message);
});

test("failure parsing handles partial tails, plain errors and missing errors", () => {
  assert.equal(getCodexFailureMessage({ stdoutTail: 'partial json\n{"type":"error","message":"Request failed"}' }), "Request failed");
  assert.equal(getCodexFailureMessage({ stdoutTail: '{"type":"turn.started"}', stderrTail: "MCP warning" }), "");
});
