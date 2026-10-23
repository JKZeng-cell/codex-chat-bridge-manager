import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { once } from "node:events";
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
  assert.deepEqual(await server.getShutdownStatus(), { busy: false });
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

test("manager shutdown closes incomplete HTTP requests instead of leaving the desktop process alive", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "manager-exit-"));
  const config = loadManagerConfig();
  config.manager = { host: "127.0.0.1", port: 0 };
  config.feishu = { ...config.feishu, appId: "", appSecret: "" };
  config.runtime = { ...config.runtime, managerStateDir: path.join(dir, "manager"), botsStateDir: path.join(dir, "bots") };
  config.cli = { ...config.cli, configDir: path.join(dir, "cli") };
  const server = createManagerServer(config, { codexStatus: { getStatus: () => ({}), refresh: async () => ({}) } });
  await server.start();
  t.after(async () => { await server.stop(); await fs.rm(dir, { recursive: true, force: true }); });
  const request = http.request("http://127.0.0.1:" + server.getAddress().port + "/api/bots", { method: "POST", headers: { Expect: "100-continue", "Content-Type": "application/json", "Content-Length": 100 } });
  request.on("error", () => {});
  const ready = once(request, "continue");
  const closed = new Promise((resolve) => request.once("close", resolve));
  request.flushHeaders();
  await ready;
  request.write("{");
  let timer;
  try {
    await Promise.race([
      server.stop(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("HTTP shutdown stalled")), 1000); })
    ]);
    await closed;
  } finally { clearTimeout(timer); request.destroy(); }
});

test("platform CLI endpoints target the selected bot, block cross-site actions and protect in-flight auth", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "manager-cli-api-"));
  const config = loadManagerConfig();
  config.manager = { host: "127.0.0.1", port: 0 };
  config.feishu = { ...config.feishu, appId: "", appSecret: "" };
  config.runtime = { ...config.runtime, managerStateDir: path.join(dir, "manager"), botsStateDir: path.join(dir, "bots") };
  config.cli = { ...config.cli, configDir: path.join(dir, "cli") };
  let active = false;
  let authorized = false;
  const starts = [];
  const calls = [];
  const manager = {
    async getStatus(bot, fresh) { calls.push(["status", bot.id, fresh]); return { platform: bot.platform, supported: true, authorized }; },
    async startAuthorization(bot) { calls.push(["authorize", bot.id]); active = true; return { authTask: { running: true } }; },
    async cancelAuthorization(bot) { calls.push(["cancel", bot.id]); active = false; return { authTask: { running: false } }; },
    isActive(id) { return active && (!id || id === "team-one"); }, close() {}
  };
  const serviceManager = { async startAutoStartBots() {}, async stopAll() {}, async start(id) { starts.push(id); },
    async listStatuses() { return [{ bot: { id: "team-one" }, service: { queue: { activeCount: 0, pendingCount: 0 } } }]; } };
  const server = createManagerServer(config, { platformCliManager: manager, serviceManager, codexStatus: { getStatus: () => ({}), refresh: async () => ({}) } });
  await server.start();
  t.after(async () => { await server.stop(); await fs.rm(dir, { recursive: true, force: true }); });
  const base = "http://127.0.0.1:" + server.getAddress().port;
  const bot = { id: "team-one", platform: "wecom", name: "Team", appId: "app", appSecret: "secret", autoStart: false };
  assert.equal((await fetch(base + "/api/bots", { method: "POST", body: JSON.stringify(bot) })).status, 200);
  assert.equal((await fetch(base + "/api/platform-cli/team-one")).status, 200);
  assert.deepEqual(calls.at(-1), ["status", "team-one", undefined]);
  assert.equal((await fetch(base + "/api/platform-cli/team-one/check", { method: "POST" })).status, 200);
  assert.deepEqual(calls.at(-1), ["status", "team-one", true]);
  assert.equal((await fetch(base + "/api/platform-cli/team-one/enable", { method: "POST" })).status, 500);
  assert.equal((await (await fetch(base + "/api/bots")).json()).bots[0].platformCliEnabled, false);
  assert.equal((await fetch(base + "/api/platform-cli/team-one/authorize", { method: "POST", headers: { Origin: "https://evil.test" } })).status, 403);
  assert.equal(active, false);
  assert.equal((await fetch(base + "/api/platform-cli/team-one/authorize", { method: "POST" })).status, 200);
  assert.equal((await fetch(base + "/api/bots/team-one", { method: "DELETE" })).status, 500);
  assert.equal((await fetch(base + "/api/bots", { method: "POST", body: JSON.stringify(bot) })).status, 500);
  assert.equal((await fetch(base + "/api/maintenance", { method: "POST", body: JSON.stringify({ action: "check" }) })).status, 500);
  assert.equal((await fetch(base + "/api/platform-cli/team-one/cancel", { method: "POST" })).status, 200);
  assert.equal(active, false);
  authorized = true;
  assert.equal((await fetch(base + "/api/platform-cli/team-one/enable", { method: "POST", headers: { Origin: "https://evil.test" } })).status, 403);
  assert.equal(starts.length, 0);
  const enabled = await (await fetch(base + "/api/platform-cli/team-one/enable", { method: "POST" })).json();
  assert.equal(enabled.applied, true);
  assert.deepEqual(starts, ["team-one"]);
  assert.equal((await (await fetch(base + "/api/bots")).json()).bots[0].platformCliEnabled, true);
  assert.equal((await fetch(base + "/api/platform-cli/missing")).status, 404);
});
