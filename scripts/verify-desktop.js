import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { listPackage, extractFile } from "@electron/asar";

const directory = path.resolve(process.argv[2] || "dist/win-unpacked");
const archive = path.join(directory, "resources", "app.asar");
const files = listPackage(archive).map((value) => value.replaceAll("\\", "/").replace(/^\//, ""));
assert.equal(files.some((file) => /^(?:state|runs|pet-runs|\.env)(?:\/|$)/.test(file)), false, "Private runtime files must not be packaged.");
for (const required of ["electron/main.js", "src/public/avatars.js", "src/public/index.html", "LICENSE", "NOTICE.md"]) assert.ok(files.includes(required), "Missing packaged file: " + required);
const packaged = JSON.parse(extractFile(archive, "package.json").toString());
const source = JSON.parse(fs.readFileSync("package.json", "utf8"));
assert.equal(packaged.version, source.version);
for (const file of ["tools/lark-cli.exe", "tools/codex/bin/codex.exe", "tools/CODEX-LICENSE", "tools/LARK-CLI-LICENSE", "icon.png"]) assert.ok(fs.existsSync(path.join(directory, "resources", file)), "Missing runtime resource: " + file);
console.log(JSON.stringify({ verified: true, version: packaged.version, archiveEntries: files.length, privateRootPaths: 0, bundledTools: true }));
