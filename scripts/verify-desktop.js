import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { listPackage, extractFile } from "@electron/asar";

const directory = path.resolve(process.argv[2] || "dist/win-unpacked");
const archive = path.join(directory, "resources", "app.asar");
const files = listPackage(archive).map((value) => value.replaceAll("\\", "/").replace(/^\//, ""));
assert.equal(files.some((file) => /^(?:state|runs|pet-runs|output|\.env)(?:\/|$)/.test(file)), false, "Private runtime and promotional source files must not be packaged.");
for (const required of ["electron/main.js", "electron/tray.js", "electron/shutdown.js", "src/codexStatus.js", "src/platformCli.js", "src/platformCliManager.js", "src/platformReplies.js", "src/public/platformCli.js", "src/public/systemStatus.js", "src/public/avatars.js", "src/public/index.html", "LICENSE", "NOTICE.md"]) assert.ok(files.includes(required), "Missing packaged file: " + required);
const packaged = JSON.parse(extractFile(archive, "package.json").toString());
const source = JSON.parse(fs.readFileSync("package.json", "utf8"));
assert.equal(packaged.version, source.version);
for (const file of files.filter((name) => /^(src|electron)\/.+\.(js|html|css)$/.test(name))) {
  assert.ok(extractFile(archive, file.split("/").join(path.sep)).equals(fs.readFileSync(file)), "Packaged source differs from checkout: " + file);
}
const frontend = extractFile(archive, path.join("src", "public", "index.html")).toString();
for (const marker of ["runtime-health", "codex-health", "check-codex-status", "Powered by JKZeng"]) assert.ok(frontend.includes(marker), "Missing frontend feature: " + marker);
for (const file of ["tools/lark-cli.exe", "tools/wecom-cli.exe", "tools/dws.exe", "tools/platform-tools.json", "tools/skills/wecomcli-shared/SKILL.md", "tools/skills/dingtalk-shared/SKILL.md", "tools/codex/bin/codex.exe", "tools/CODEX-LICENSE", "tools/LARK-CLI-LICENSE", "tools/WECOM-CLI-LICENSE", "tools/DINGTALK-CLI-LICENSE", "tools/DINGTALK-CLI-NOTICE", "icon.png", "icon.ico"]) assert.ok(fs.existsSync(path.join(directory, "resources", file)), "Missing runtime resource: " + file);
const toolsRoot = path.join(directory, "resources", "tools");
const inventory = JSON.parse(fs.readFileSync(path.join(toolsRoot, "platform-tools.json")));
const pins = JSON.parse(fs.readFileSync("build/platform-tools.lock.json"));
const hash = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
for (const platform of ["wecom", "dingtalk"]) {
  const item = inventory[platform];
  assert.equal(item.version, pins[platform].version);
  assert.equal(item.file, platform === "wecom" ? "wecom-cli.exe" : "dws.exe");
  assert.equal(hash(path.join(toolsRoot, item.file)), item.sha256);
  assert.ok(item.skills.length > 0);
  for (const skill of item.skills) {
    assert.match(skill.name, /^(wecomcli|dingtalk)-[a-z0-9-]+$/);
    assert.equal(hash(path.join(toolsRoot, "skills", skill.name, "SKILL.md")), skill.sha256);
  }
}
console.log(JSON.stringify({ verified: true, version: packaged.version, archiveEntries: files.length, privateRootPaths: 0, bundledTools: true }));
