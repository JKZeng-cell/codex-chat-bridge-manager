import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createCliTaskManager } from "../src/cliTaskManager.js";

test("public CLI status excludes private authorization codes without changing saved state", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cli-status-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const secret = "test-private-device-code";
  const saved = JSON.stringify({ status: "pending", deviceCode: secret, logTail: `poll ${secret}` });
  await fs.writeFile(path.join(dir, "cli-auth-state.json"), saved);
  await fs.writeFile(path.join(dir, "pending-auth.json"), JSON.stringify({ deviceCode: secret, verificationUrl: "https://example.test/verify" }));
  const manager = createCliTaskManager({ runtime: { managerStateDir: dir }, cli: { configDir: dir } });
  const status = await manager.getStatus();
  assert.equal(JSON.stringify(status).includes(secret), false);
  assert.equal(status.pendingAuth.verificationUrl, "https://example.test/verify");
  assert.equal(await fs.readFile(path.join(dir, "cli-auth-state.json"), "utf8"), saved);
});
