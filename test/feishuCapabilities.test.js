import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCodexPrompt,
  buildFeishuCapabilityContext,
  buildFeishuHelpText,
  detectFeishuModules
} from "../src/feishuCapabilities.js";
import {
  buildFeishuCliArgs,
  buildFeishuCliInvocation,
  buildFeishuCliSpawn,
  resolveFeishuCliBin,
  resolveFeishuCliIdentity
} from "../src/feishuCli.js";

test("detectFeishuModules recognizes docs and calendar prompts", () => {
  assert.deepEqual(
    detectFeishuModules("Update a Feishu doc and check tomorrow Feishu calendar"),
    ["docs", "calendar"]
  );
});

test("detectFeishuModules recognizes Chinese Feishu modules", () => {
  assert.deepEqual(
    detectFeishuModules("\u66f4\u65b0\u98de\u4e66\u6587\u6863\u5e76\u68c0\u67e5\u660e\u5929\u7684\u98de\u4e66\u65e5\u5386"),
    ["docs", "calendar"]
  );
});

test("detectFeishuModules recognizes messages and sheets prompts", () => {
  assert.deepEqual(
    detectFeishuModules("Search Feishu message history and update a Feishu spreadsheet"),
    ["messages", "sheets"]
  );
});

test("buildFeishuCapabilityContext stays empty for non-Feishu tasks", () => {
  assert.equal(buildFeishuCapabilityContext("Run this Node test suite"), "");
});

test("buildFeishuCapabilityContext ignores generic task wording", () => {
  assert.equal(buildFeishuCapabilityContext("Explain this task queue implementation"), "");
});

test("buildCodexPrompt injects Feishu guidance for Base work", () => {
  const prompt = buildCodexPrompt("Add one deployment record into a Feishu Base table", {
    replySkillContext: "Return only the final message body.",
    requesterOpenId: "ou_requester_123",
    grantRequesterManageAccess: true
  });
  assert.match(prompt, /lark-cli/);
  assert.match(prompt, /\+record-upsert --json/);
  assert.match(prompt, /drive permission\.members create/);
  assert.match(prompt, /ou_requester_123/);
  assert.match(prompt, /Final reply formatting:/);
  assert.match(prompt, /User request:/);
});

test("buildCodexPrompt injects latest docs v2 guidance", () => {
  const prompt = buildCodexPrompt("Update a Feishu doc", {});
  assert.match(prompt, /docs \+fetch --api-version v2/);
  assert.match(prompt, /docs \+update --api-version v2/);
});

test("buildCodexPrompt only injects Feishu skill catalog for Feishu work", () => {
  assert.doesNotMatch(buildCodexPrompt("Run tests", { feishuSkillContext: "Installed Feishu/Lark skills" }), /Feishu skills/);
  assert.match(
    buildCodexPrompt("Search Feishu Drive", { feishuSkillContext: "Installed Feishu/Lark skills" }),
    /Feishu skills/
  );
});

test("buildFeishuCapabilityContext can skip requester grant guidance", () => {
  const prompt = buildFeishuCapabilityContext("Create a Feishu spreadsheet", {
    requesterOpenId: "ou_requester_123",
    grantRequesterManageAccess: false
  });
  assert.doesNotMatch(prompt, /Requester access policy/);
});

test("buildFeishuHelpText includes all supported module families", () => {
  const help = buildFeishuHelpText("/codex");
  assert.match(help, /message history/i);
  assert.match(help, /Feishu Base/i);
  assert.match(help, /spreadsheet/i);
  assert.match(help, /Feishu task/i);
  assert.match(help, /Feishu Drive/i);
  assert.match(help, /Feishu Mail/i);
  assert.match(help, /lark-cli update/);
  assert.match(help, /\/send-file/);
  assert.match(help, /\/send-image/);
  assert.match(help, /\/send-audio/);
  assert.match(help, /\/send-voice/);
  assert.match(help, /lark-cli docs --help/);
});

test("buildFeishuCliArgs defaults to bot identity for docs commands", () => {
  assert.deepEqual(buildFeishuCliArgs(["docs", "+create", "--api-version", "v2", "--title", "Weekly note"]), [
    "docs",
    "+create",
    "--api-version",
    "v2",
    "--title",
    "Weekly note",
    "--as",
    "bot"
  ]);
});

test("buildFeishuCliArgs does not append identity to top-level help", () => {
  assert.deepEqual(buildFeishuCliArgs(["docs", "--help"]), ["docs", "--help"]);
});

test("resolveFeishuCliIdentity switches docs search to user mode", () => {
  assert.equal(resolveFeishuCliIdentity(["docs", "+search", "--query", "roadmap"], "bot"), "user");
});

test("resolveFeishuCliIdentity switches message search to user mode", () => {
  assert.equal(resolveFeishuCliIdentity(["im", "+messages-search", "--query", "deploy"], "bot"), "user");
});

test("buildFeishuCliArgs leaves nested help commands unchanged", () => {
  assert.deepEqual(buildFeishuCliArgs(["task", "subtasks", "--help"]), ["task", "subtasks", "--help"]);
});

test("buildFeishuCliArgs leaves nested resource commands unchanged for explicit identity", () => {
  assert.deepEqual(buildFeishuCliArgs(["calendar", "events", "list", "--as", "user"]), [
    "calendar",
    "events",
    "list",
    "--as",
    "user"
  ]);
});

test("buildFeishuCliArgs appends identity to nested resource commands", () => {
  assert.deepEqual(buildFeishuCliArgs(["calendar", "events", "list"]), [
    "calendar",
    "events",
    "list",
    "--as",
    "bot"
  ]);
});

test("buildFeishuCliArgs leaves auth commands unchanged", () => {
  assert.deepEqual(buildFeishuCliArgs(["auth", "status"]), ["auth", "status"]);
});

test("buildFeishuCliArgs leaves update and profile commands unchanged", () => {
  assert.deepEqual(buildFeishuCliArgs(["update"]), ["update"]);
  assert.deepEqual(buildFeishuCliArgs(["--profile", "prod", "profile", "list"]), [
    "--profile",
    "prod",
    "profile",
    "list"
  ]);
});

test("buildFeishuCliArgs supports latest identity-aware commands", () => {
  assert.deepEqual(buildFeishuCliArgs(["mail", "+triage"], "user"), ["mail", "+triage", "--as", "user"]);
  assert.deepEqual(buildFeishuCliArgs(["whiteboard", "+create"], "bot"), [
    "whiteboard",
    "+create",
    "--as",
    "bot"
  ]);
});

test("resolveFeishuCliBin defaults to the global binary", () => {
  assert.match(resolveFeishuCliBin(""), /lark-cli(\.cmd)?$/);
});

test("buildFeishuCliInvocation targets the configured global binary", () => {
  const invocation = buildFeishuCliInvocation(["docs", "+create", "--title", "Weekly note"], {
    cliBin: "lark-cli",
    fallbackIdentity: "bot"
  });

  assert.deepEqual(invocation, {
    command: "lark-cli",
    args: ["docs", "+create", "--title", "Weekly note", "--as", "bot"]
  });
});

test("buildFeishuCliSpawn uses cmd shim on Windows", () => {
  const spawnPlan = buildFeishuCliSpawn(["docs", "+create", "--title", "Weekly note"], {
    cliBin: "lark-cli",
    fallbackIdentity: "bot"
  });

  if (process.platform === "win32") {
    assert.deepEqual(spawnPlan, {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "lark-cli", "docs", "+create", "--title", "Weekly note", "--as", "bot"]
    });
    return;
  }

  assert.deepEqual(spawnPlan, {
    command: "lark-cli",
    args: ["docs", "+create", "--title", "Weekly note", "--as", "bot"]
  });
});
