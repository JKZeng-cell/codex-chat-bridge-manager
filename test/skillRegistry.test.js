import test from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { buildInstalledLarkSkillContext, listSkillsSync } from "../src/skillRegistry.js";

test("listSkillsSync reads local skill front matter", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "codex-skill-registry-"));
  const skillDir = path.join(root, "lark-demo");
  const skillPath = path.join(skillDir, "SKILL.md");
  await fsp.mkdir(skillDir, { recursive: true });
  await fsp.writeFile(
    skillPath,
    [
      "---",
      "name: lark-demo",
      "description: \"Demo Feishu skill\"",
      "---",
      "",
      "# Demo"
    ].join("\n"),
    "utf8"
  );

  const skills = listSkillsSync([root], { selectedPaths: [skillPath] });
  assert.equal(skills.length, 1);
  assert.equal(skills[0].name, "lark-demo");
  assert.equal(skills[0].description, "Demo Feishu skill");
  assert.equal(skills[0].selected, true);
});

test("buildInstalledLarkSkillContext includes only lark skills", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "codex-lark-skill-context-"));
  const larkDir = path.join(root, "lark-demo");
  const otherDir = path.join(root, "other-demo");
  await fsp.mkdir(larkDir, { recursive: true });
  await fsp.mkdir(otherDir, { recursive: true });
  await fsp.writeFile(
    path.join(larkDir, "SKILL.md"),
    "---\nname: lark-demo\ndescription: \"A long Feishu skill description that should be compacted\"\n---\n",
    "utf8"
  );
  await fsp.writeFile(
    path.join(otherDir, "SKILL.md"),
    "---\nname: other-demo\ndescription: \"Not Feishu\"\n---\n",
    "utf8"
  );

  const context = buildInstalledLarkSkillContext([root], { maxDescriptionChars: 32 });
  assert.match(context, /Installed Feishu\/Lark skills/);
  assert.match(context, /lark-demo/);
  assert.match(context, /SKILL\.md/);
  assert.doesNotMatch(context, /other-demo/);
});
