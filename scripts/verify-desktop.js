import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { listPackage, extractFile } from "@electron/asar";

const directory = path.resolve(process.argv[2] || "dist/win-unpacked");
const archive = path.join(directory, "resources", "app.asar");
const files = listPackage(archive).map((value) => value.replaceAll("\\", "/").replace(/^\//, ""));
assert.equal(files.some((file) => /^(?:state|runs|pet-runs|output|\.env)(?:\/|$)/.test(file)), false, "Private runtime and promotional source files must not be packaged.");
for (const required of ["electron/main.js", "electron/tray.js", "electron/shutdown.js", "src/codexStatus.js", "src/public/systemStatus.js", "src/public/avatars.js", "src/public/index.html", "LICENSE", "NOTICE.md"]) assert.ok(files.includes(required), "Missing packaged file: " + required);
const packaged = JSON.parse(extractFile(archive, "package.json").toString());
const source = JSON.parse(fs.readFileSync("package.json", "utf8"));
assert.equal(packaged.version, source.version);
const frontend = extractFile(archive, path.join("src", "public", "index.html")).toString();
for (const marker of ["runtime-health", "codex-health", "check-codex-status", "Powered by JKZeng"]) assert.ok(frontend.includes(marker), "Missing frontend feature: " + marker);
for (const file of ["tools/lark-cli.exe", "tools/codex/bin/codex.exe", "tools/CODEX-LICENSE", "tools/LARK-CLI-LICENSE", "icon.png", "icon.ico"]) assert.ok(fs.existsSync(path.join(directory, "resources", file)), "Missing runtime resource: " + file);
console.log(JSON.stringify({ verified: true, version: packaged.version, archiveEntries: files.length, privateRootPaths: 0, bundledTools: true }));
