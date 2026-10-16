import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { loadManagerConfig } from "../src/config.js";
import { createManagerServer } from "../src/managerServer.js";

test("manager APIs mask platform credentials, preserve legacy forms, and reject cross-site writes", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "manager-api-"));
  const config = loadManagerConfig();
  config.manager = { host: "127.0.0.1", port: 0 };
  config.feishu = { ...config.feishu, appId: "", appSecret: "" };
  config.runtime = { ...config.runtime, managerStateDir: path.join(dir, "manager"), botsStateDir: path.join(dir, "bots") };
  config.cli = { ...config.cli, configDir: path.join(dir, "cli") };
  config.skills.roots = [];
  let checks = 0;
  const codex = { state: "ready", version: "1.2.3", authMode: "ChatGPT", checkedAt: new Date().toISOString(), checking: false };
  const server = createManagerServer(config, { codexStatus: { getStatus: () => codex, refresh: async () => { checks++; return codex; } } });
  await server.start();
  t.after(async () => { await server.stop(); await fs.rm(dir, { recursive: true, force: true }); });
  const base = "http://127.0.0.1:" + server.getAddress().port;
  const body = { id: "wecom-one", name: "Team", platform: "wecom", appId: "bot", appSecret: "never-expose-this", autoStart: false };
  let response = await fetch(base + "/api/bots", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).bot.appSecret, "********");
  for (const endpoint of ["/api/overview", "/api/bots", "/api/system/status"]) {
    response = await fetch(base + endpoint);
    assert.equal(response.status, 200);
    assert.equal((await response.text()).includes("never-expose-this"), false);
  }
  response = await fetch(base + "/api/services", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "stopAll" }) });
  assert.equal((await response.text()).includes("never-expose-this"), false);
  response = await fetch(base + "/api/bots", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://malicious.test" }, body: JSON.stringify(body) });
  assert.equal(response.status, 403);
  const hostStatus = await new Promise((resolve, reject) => {
    http.get(base + "/api/overview", { headers: { Host: "untrusted.example" } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    }).on("error", reject);
  });
  assert.equal(hostStatus, 403);
  response = await fetch(base + "/api/bots", { method: "POST", body: JSON.stringify({ name: "x".repeat(1024 * 1024) }) });
  assert.equal(response.status, 413);
  assert.equal((await fetch(base + "/connections.js")).status, 200);
  assert.equal((await fetch(base + "/api/maintenance")).status, 200);
  for (const endpoint of ["/api/overview", "/api/system/status"]) {
    const payload = await (await fetch(base + endpoint)).json();
    assert.equal(payload.system.state, "running");
    assert.equal(payload.system.pid, process.pid);
    assert.deepEqual(payload.codex, codex);
  }
  response = await fetch(base + "/api/codex/status", { method: "POST" });
  assert.deepEqual(await response.json(), codex);
  assert.equal(checks, 1);
  response = await fetch(base + "/api/codex/status", { method: "POST", headers: { Origin: "https://malicious.test" } });
  assert.equal(response.status, 403);
  assert.equal(checks, 1);
});
