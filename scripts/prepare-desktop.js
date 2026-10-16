import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

if (process.platform !== "win32" || process.arch !== "x64") throw new Error("This release target requires Windows x64.");
const root = process.cwd();
const target = path.join(root, "build", "runtime");
const codexRoot = path.join(root, "node_modules", "@openai", "codex-win32-x64", "vendor", "x86_64-pc-windows-msvc");
await fs.mkdir(target, { recursive: true });
const cliRoot = path.join(root, "node_modules", "@larksuite", "cli");
const cli = path.join(cliRoot, "bin", "lark-cli.exe");
try { await fs.access(cli); } catch {
  const result = spawnSync(process.execPath, [path.join(cliRoot, "scripts", "install.js")], { stdio: "inherit", env: { ...process.env, CI: "true" } });
  if (result.status !== 0) throw new Error("Official Feishu CLI binary installation failed.");
}
await fs.cp(codexRoot, path.join(target, "codex"), { recursive: true });
await fs.copyFile(cli, path.join(target, "lark-cli.exe"));
await fs.copyFile(path.join(cliRoot, "LICENSE"), path.join(target, "LARK-CLI-LICENSE"));
const codexPackage = JSON.parse(await fs.readFile(path.join(root, "node_modules", "@openai", "codex", "package.json"), "utf8"));
if (!/^\d+\.\d+\.\d+$/.test(codexPackage.version)) throw new Error("Unexpected Codex version.");
const licenseUrl = `https://raw.githubusercontent.com/openai/codex/rust-v${codexPackage.version}/LICENSE`;
const license = await fetch(licenseUrl);
if (!license.ok) throw new Error("Cannot retrieve the pinned Codex license.");
const licenseText = await license.text();
if (!licenseText.includes("Apache License")) throw new Error("Unexpected Codex license.");
await fs.writeFile(path.join(target, "CODEX-LICENSE"), licenseText);
for (const [name, command] of [["Codex", path.join(target, "codex", "bin", "codex.exe")], ["Feishu CLI", path.join(target, "lark-cli.exe")]]) {
  const check = spawnSync(command, ["--version"], { encoding: "utf8", windowsHide: true });
  if (check.status !== 0) throw new Error(`${name} binary verification failed.`);
  console.log(`${name}: ${check.stdout.trim()}`);
}
