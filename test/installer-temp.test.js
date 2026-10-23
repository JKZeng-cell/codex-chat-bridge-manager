import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

function findCachedFile(directory, name) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isFile() && entry.name === name) return file;
    if (entry.isDirectory()) {
      const found = findCachedFile(file, name);
      if (found) return found;
    }
  }
}

test("compiled NSIS preflight preserves parameters and cleans relocated temporary files", { skip: process.platform !== "win32" }, (t) => {
  const cache = path.join(process.env.LOCALAPPDATA || "", "electron-builder", "Cache");
  const compiler = findCachedFile(path.join(cache, "nsis-3.0.4.1"), "makensis.exe");
  const plugin = findCachedFile(path.join(cache, "nsis-resources-3.4.1"), "StdUtils.dll");
  if (!compiler || !plugin) return t.skip("Native NSIS toolchain is not cached; no download is performed by tests.");
  const unicodePlugin = path.join(path.dirname(path.dirname(plugin)), "x86-unicode");
  const project = process.cwd();
  const base = path.join(project, "state");
  fs.mkdirSync(base, { recursive: true });
  const root = fs.mkdtempSync(path.join(base, "installer-native-"));
  try {
    const free = (directory) => {
      const value = fs.statfsSync(directory, { bigint: true });
      return value.bavail * value.bsize;
    };
    const originalTemp = os.tmpdir();
    const threshold = free(originalTemp) + 128n * 1024n * 1024n;
    const canRelocate = free(root) > threshold + 128n * 1024n * 1024n;
    const required = canRelocate ? threshold : 1048576n;
    const exe = path.join(root, "fixture.exe");
    const report = path.join(root, "report.txt");
    const install = path.join(root, "install with spaces");
    const args = ["/V2", `/DBRIDGE_PROJECT=${project}`, `/DBRIDGE_PLUGIN_DIR=${unicodePlugin}`, `/DBRIDGE_OUTPUT=${exe}`, `/DBRIDGE_REPORT=${report}`, `/DBRIDGE_INSTALL_DIR=${install}`, `/DBRIDGE_MIN_TEMP_BYTES=${required}`, path.join(project, "test/fixtures/installer-temp.nsi")];
    const built = spawnSync(compiler, args, { encoding: "utf8", windowsHide: true, timeout: 20000 });
    assert.equal(built.status, 0, built.stderr || built.stdout);
    const run = spawnSync(exe, ["/S", `/D=${install}`], { encoding: "utf8", windowsHide: true, timeout: 20000 });
    assert.equal(run.status, 0, run.stderr || run.error?.message);
    const [temp, plugins, installed] = fs.readFileSync(report, "utf8").split(/\r?\n/);
    assert.equal(installed, install);
    assert.equal(fs.existsSync(plugins), false);
    if (canRelocate) {
      assert.equal(path.dirname(temp), root);
      assert.match(path.basename(temp), /^CodexBridgeSetup-\{[0-9A-F-]+\}$/i);
      assert.equal(fs.existsSync(temp), false);
      t.diagnostic("Exercised low-space relaunch to another volume and scoped cleanup.");
    } else {
      assert.equal(temp.toLowerCase(), originalTemp.toLowerCase());
      t.diagnostic("Normal-space path verified; a roomier second volume is needed for relocation coverage.");
    }
    fs.unlinkSync(report);
    const blockedArgs = args.map((arg) => arg.startsWith("/DBRIDGE_MIN_TEMP_BYTES=") ? `/DBRIDGE_MIN_TEMP_BYTES=${2n ** 62n}` : arg);
    const blockedBuild = spawnSync(compiler, blockedArgs, { encoding: "utf8", windowsHide: true, timeout: 20000 });
    assert.equal(blockedBuild.status, 0, blockedBuild.stderr || blockedBuild.stdout);
    const blockedRun = spawnSync(exe, ["/S"], { encoding: "utf8", windowsHide: true, timeout: 20000 });
    assert.equal(blockedRun.status, 50, blockedRun.stderr || blockedRun.error?.message);
    assert.equal(fs.existsSync(report), false, "Low-space setup must not enter the install section.");
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(base) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
