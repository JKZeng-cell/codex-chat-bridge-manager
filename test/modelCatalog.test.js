import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { readModelCatalog } from "../src/modelCatalog.js";

test("model catalog follows visible cached models in priority order", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-models-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dir, "models_cache.json"), JSON.stringify({ models: [
    { slug: "hidden", visibility: "hide", priority: 0 },
    { slug: "second", display_name: "Second", visibility: "list", priority: 2 },
    { slug: "first", display_name: "First", visibility: "list", priority: 1 },
    { slug: "first", visibility: "list", priority: 3 },
    { visibility: "list" }
  ] }));
  assert.deepEqual(await readModelCatalog(dir), [
    { id: "first", label: "First" },
    { id: "second", label: "Second" }
  ]);
  await fs.writeFile(path.join(dir, "models_cache.json"), "invalid json");
  assert.deepEqual(await readModelCatalog(dir), []);
});
