import test from "node:test";
import assert from "node:assert/strict";

import { loadManagerConfig } from "../src/config.js";
import { createServiceManager } from "../src/serviceManager.js";

function fixture() {
  const bot = { id: "test", name: "Test", appId: "app", appSecret: "secret", model: "old-model" };
  const instances = [];
  const store = { async get(id) { return id === bot.id ? { ...bot } : null; }, async list() { return [{ ...bot }]; } };
  const manager = createServiceManager(loadManagerConfig(), store, {
    createRuntime(config) {
      const status = { state: "stopped", model: config.codex.model, queue: { activeCount: 0, pendingCount: 0 } };
      const instance = {
        config, status, stopCount: 0,
        getStatus() { return { ...status }; },
        async start() { status.state = "running"; return this.getStatus(); },
        async stop() { this.stopCount++; status.state = "stopped"; return this.getStatus(); }
      };
      instances.push(instance);
      return instance;
    }
  });
  return { bot, manager, instances };
}

test("starting a saved bot rebuilds its runtime with the new model and credentials", async () => {
  const { bot, manager, instances } = fixture();
  await manager.start(bot.id);
  bot.model = "new-model";
  bot.appSecret = "updated-secret";
  let entry = (await manager.listStatuses())[0];
  assert.equal(entry.service.model, "old-model");
  assert.equal(entry.service.configurationChanged, true);
  await manager.start(bot.id);
  entry = (await manager.listStatuses())[0];
  assert.equal(instances.length, 2);
  assert.equal(instances[0].stopCount, 1);
  assert.equal(instances[1].config.feishu.appSecret, "updated-secret");
  assert.equal(entry.service.model, "new-model");
  assert.equal(entry.service.configurationChanged, false);
});

test("restart recreates the runner instead of reusing the websocket runtime", async () => {
  const { bot, manager, instances } = fixture();
  await manager.start(bot.id);
  bot.model = "new-model";
  await manager.restart(bot.id);
  assert.equal(instances.length, 2);
  assert.equal(instances[1].config.codex.model, "new-model");
  await manager.start(bot.id);
  assert.equal(instances.length, 2);
});

test("applying configuration does not discard running or queued jobs", async () => {
  const { bot, manager, instances } = fixture();
  await manager.start(bot.id);
  bot.model = "new-model";
  for (const queue of [{ activeCount: 1, pendingCount: 0 }, { activeCount: 0, pendingCount: 1 }]) {
    instances[0].status.queue = queue;
    await assert.rejects(manager.start(bot.id), /任务/);
    await assert.rejects(manager.restart(bot.id), /任务/);
    assert.equal(instances.length, 1);
    assert.equal(instances[0].stopCount, 0);
  }
});

test("simultaneous start requests share one runtime and model can follow the default again", async () => {
  const { bot, manager, instances } = fixture();
  await Promise.all([manager.start(bot.id), manager.start(bot.id)]);
  assert.equal(instances.length, 1);
  bot.model = "";
  await manager.restart(bot.id);
  assert.equal(instances[1].config.codex.model, loadManagerConfig().codex.model);
});
