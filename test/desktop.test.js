import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { desktopPaths, isAppNavigation, isExternalWebLink } from "../electron/desktop-policy.js";
import { buildFeishuCliSpawn } from "../src/feishuCli.js";

test("desktop data and tools stay separate from packaged application resources", () => {
  const paths = desktopPaths(path.resolve("profile"), path.resolve("resources"), true);
  assert.equal(paths.state, path.resolve("profile/state"));
  assert.equal(paths.codex, path.resolve("resources/tools/codex/bin/codex.exe"));
  assert.equal(paths.cli, path.resolve("profile/tools/lark-cli.exe"));
  assert.equal(paths.wecom, path.resolve("resources/tools/wecom-cli.exe"));
  assert.equal(paths.dingtalk, path.resolve("resources/tools/dws.exe"));
  assert.equal(paths.skills, path.resolve("resources/tools/skills"));
  assert.equal(desktopPaths("profile", "root", false).bundledCli, path.join("root", "build", "runtime", "lark-cli.exe"));
});
test("desktop external links and navigation reject privileged protocols and other origins", () => {
  const origin = "http://127.0.0.1:3211";
  assert.equal(isAppNavigation(origin + "/settings", origin), true);
  for (const url of ["http://127.0.0.1:3210", "file:///test", "javascript:alert(1)", "bad"]) assert.equal(isAppNavigation(url, origin), false);
  assert.equal(isExternalWebLink("https://github.com/example"), true);
  for (const url of ["file:///test", "javascript:alert(1)", "http://example.com", "https://user:secret@example.com"]) assert.equal(isExternalWebLink(url), false);
});
test("bundled native Feishu CLI executes directly even when its path contains spaces", () => {
  const command = path.resolve("Application Data/lark-cli.exe");
  assert.deepEqual(buildFeishuCliSpawn(["--version"], { cliBin: command }), { command, args: ["--version"] });
});
