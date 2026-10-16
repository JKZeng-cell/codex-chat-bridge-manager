import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fsp from "node:fs/promises";

import { createBotStore } from "../src/botStore.js";

test("bot store seeds and updates bot records", async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "codex-bot-store-"));
  const store = createBotStore(path.join(tempDir, "bots.json"), {
    seedBots: [
      {
        id: "seed",
        name: "Seed Bot",
        appId: "cli_seed",
        appSecret: "secret"
      }
    ]
  });

  const seeded = await store.list();
  assert.equal(seeded.length, 1);
  assert.equal(seeded[0].name, "Seed Bot");

  const updated = await store.update("seed", {
    commandPrefix: "/ops",
    preferredSkills: ["C:\\skills\\demo\\SKILL.md"]
  });

  assert.equal(updated.commandPrefix, "/ops");
  assert.deepEqual(updated.preferredSkills, ["C:\\skills\\demo\\SKILL.md"]);
  const withModel = await store.update("seed", { model: "gpt-6.1-sol" });
  assert.equal(withModel.model, "gpt-6.1-sol");
  const defaultModel = await store.update("seed", { model: "" });
  assert.equal(defaultModel.model, "");
});
