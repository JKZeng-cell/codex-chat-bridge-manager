import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function collectTests(rootDir) {
  const files = [];

  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTests(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".test.js")) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

const testRoot = path.resolve(process.cwd(), "test");
const testFiles = collectTests(testRoot);

if (testFiles.length === 0) {
  console.error("No test files found under ./test");
  process.exit(1);
}

const [major, minor] = process.versions.node.split(".").map(Number);
const isolationFlag = major > 23 || (major === 23 && minor >= 6)
  ? "--test-isolation=none"
  : "--experimental-test-isolation=none";
const result = spawnSync(process.execPath, ["--test", isolationFlag, ...testFiles], {
  stdio: "inherit",
  env: process.env
});

process.exit(result.status ?? 1);
