import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

test("installer uses a scoped graceful close hook instead of directory-wide process killing", () => {
  const config = JSON.parse(fs.readFileSync("electron-builder.json", "utf8"));
  assert.equal(config.nsis.include, "build/installer.nsh");
  const helper = fs.readFileSync("build/installer-process-check.ps1", "utf8");
  assert.ok(helper.includes("CloseMainWindow"));
  assert.ok(helper.includes("Chrome_WidgetWin_"));
  assert.ok(helper.includes("0x0010"));
  assert.ok(helper.includes("0x00c00000"));
  assert.equal(/Stop-Process|taskkill|\.Kill\(/i.test(helper), false);
  assert.equal(config.nsis.deleteAppDataOnUninstall, false);
});

test("Windows installer detection excludes its own setup process and similarly prefixed directories", { skip: process.platform !== "win32" }, () => {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.resolve("test/installer-process-check.test.ps1")], { encoding: "utf8", windowsHide: true, timeout: 15000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});

test("Windows hidden application receives a normal close and can reject it while busy", { skip: process.platform !== "win32" }, () => {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.resolve("test/installer-window-close.test.ps1")], { encoding: "utf8", windowsHide: true, timeout: 45000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});
