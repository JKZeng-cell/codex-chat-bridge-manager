import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { c as createTar } from "tar";
import { safeArchivePath, verifyIntegrity, extractToolArchive } from "../scripts/platform-tools.js";
import { loadManagerConfig, buildRuntimeConfigFromBot } from "../src/config.js";
import { listSkills, buildInstalledLarkSkillContext } from "../src/skillRegistry.js";
import { platformCliPrompt, resolvePlatformCli } from "../src/platformCli.js";

test("bundled tooling rejects archive traversal and NTFS alternate paths", () => {
  const root = path.resolve("owned-stage");
  for (const name of ["../escape", "/root", "C:/escape", "safe/../../escape", "file:stream", "safe\\file", "unsafe\0file"]) assert.throws(() => safeArchivePath(root, name), /archive|Archive/);
  assert.equal(safeArchivePath(root, "skills/test/SKILL.md"), path.join(root, "skills", "test", "SKILL.md"));
});

test("official artifact digests are checked before extraction and corruption fails closed", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tool-integrity-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, "artifact.bin");
  const content = Buffer.from("fixture artifact");
  await fs.writeFile(file, content);
  const digest = (algorithm, encoding) => crypto.createHash(algorithm).update(content).digest(encoding);
  await verifyIntegrity(file, "sha256:" + digest("sha256", "hex"));
  await verifyIntegrity(file, "sha512-" + digest("sha512", "base64"));
  await assert.rejects(verifyIntegrity(file, "sha256:" + "0".repeat(64)), /mismatch/);
  await assert.rejects(verifyIntegrity(file, "unverified"), /Unsupported/);
  await fs.writeFile(path.join(root, "SKILL.md"), "fixture skill");
  await createTar({ file: path.join(root, "skills.tgz"), cwd: root }, ["SKILL.md"]);
  await extractToolArchive(path.join(root, "skills.tgz"), path.join(root, "extracted"));
  assert.equal(await fs.readFile(path.join(root, "extracted", "SKILL.md"), "utf8"), "fixture skill");
});

test("bundled tools take precedence and desktop never silently falls back to a global account tool", () => {
  const binary = path.resolve("resources/tools/wecom-cli.exe");
  assert.equal(resolvePlatformCli("wecom", { bundledBin: binary, bundledOnly: true, exists: (file) => file === binary }), binary);
  assert.equal(resolvePlatformCli("wecom", { bundledBin: binary, bundledOnly: true, exists: () => false }), "");
});

test("builtin skills are discoverable without installing into global user skill directories", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bundled-skills-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const name of ["wecomcli-shared", "dingtalk-shared"]) {
    await fs.mkdir(path.join(root, name));
    await fs.writeFile(path.join(root, name, "SKILL.md"), `---\nname: ${name}\ndescription: Official fixture\n---\n`);
  }
  const skills = await listSkills([root], { bundledRoots: [root] });
  assert.equal(skills.length, 2);
  assert.equal(skills.every((skill) => skill.source === "builtin"), true);
  const binary = path.join(root, "wecom-cli.exe");
  await fs.writeFile(binary, "not executable, fixture only");
  const config = { bot: { platform: "wecom", platformCliEnabled: true }, platformClis: { wecom: { bundledBin: binary } }, skills: { bundledRoots: [root] } };
  const prompt = platformCliPrompt(config, { supported: true, authorized: true });
  assert.match(prompt, /Bundled official skills/);
  assert.match(prompt, /wecomcli-shared/);
  assert.doesNotMatch(prompt, /dingtalk-shared/);
  assert.equal(buildInstalledLarkSkillContext([root]), "");
});

test("only opted-in platform CLI profiles gain a writable Codex sandbox directory", () => {
  const config = loadManagerConfig();
  const bot = { id: "team", platform: "wecom", appId: "id", appSecret: "secret" };
  const original = buildRuntimeConfigFromBot(bot, config);
  const enabled = buildRuntimeConfigFromBot({ ...bot, platformCliEnabled: true }, config);
  assert.deepEqual(original.codex.addDirs, config.codex.addDirs);
  assert.equal(enabled.codex.addDirs.at(-1), path.join(config.runtime.botsStateDir, "team", "cli", "wecom"));
  assert.equal(config.codex.addDirs.length + 1, enabled.codex.addDirs.length);
});
