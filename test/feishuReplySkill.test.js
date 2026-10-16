import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fsp from "node:fs/promises";

import { getFeishuReplySkillContext } from "../src/feishuReplySkill.js";

test("getFeishuReplySkillContext loads local skill guidance", async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "codex-feishu-skill-"));
  const skillPath = path.join(tempDir, "SKILL.md");
  await fsp.writeFile(
    skillPath,
    "# Feishu Markdown Reply\n\nReturn only the final message body.\n",
    "utf8"
  );

  const context = getFeishuReplySkillContext(skillPath, true);
  assert.match(context, /Use the local skill/);
  assert.match(context, /Return only the final message body/);
});

test("getFeishuReplySkillContext returns empty string when disabled", () => {
  assert.equal(getFeishuReplySkillContext("ignored", false), "");
});
