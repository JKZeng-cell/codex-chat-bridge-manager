import test from "node:test";
import assert from "node:assert/strict";
import { setupPlatformCli } from "../src/public/platformCli.js";

const tick = () => new Promise((resolve) => setImmediate(resolve));
const info = (authorized) => ({ name: "Fixture CLI", installed: true, supported: true, authorized, state: authorized ? "authorized" : "idle",
  version: "1.3.4", bundled: true, skillCount: 15, configDir: "isolated", docs: "https://github.com/WecomTeam/wecom-cli", authTask: { running: false } });
function fixture(options = {}) {
  const nodes = new Map();
  const $ = (id) => {
    if (!nodes.has(id)) nodes.set(id, { hidden: false, disabled: false, html: "", handlers: {}, addEventListener(type, callback) { this.handlers[type] = callback; } });
    return nodes.get(id);
  };
  let bot = { id: "one", platform: "wecom", platformCliEnabled: false };
  const enabled = [];
  const toast = [];
  const state = { overview: {}, creating: false };
  let panel;
  panel = setupPlatformCli({ $, state, selectedBot: () => ({ bot }),
    api: options.api || (async () => info(true)), post: options.post || (async () => ({ ...info(true), applied: true, message: "enabled" })),
    escapeHtml: (value) => String(value ?? ""), patchContent: (node, html) => { node.html = html; },
    runAction: (_node, action) => action(), showToast: (text) => toast.push(text),
    async refreshAll() { bot.platformCliEnabled = true; panel.render(); }, onEnabled: (id) => enabled.push(id)
  });
  return { panel, $, enabled, toast, select: (next) => { bot = next; } };
}

test("quick CLI enable refreshes the same bot's controls and synchronizes the editor callback", async () => {
  const f = fixture();
  f.panel.render(); await tick();
  assert.equal(f.$("platform-cli-enable").hidden, false);
  assert.match(f.$("platform-cli-status").html, /内置/);
  assert.doesNotMatch(f.$("platform-cli-status").html, /安装或升级后/);
  await f.$("platform-cli-enable").handlers.click({ currentTarget: f.$("platform-cli-enable") });
  assert.equal(f.$("platform-cli-enable").hidden, true);
  assert.deepEqual(f.enabled, ["one"]);
  assert.deepEqual(f.toast, ["enabled"]);
});

test("late status responses cannot overwrite a newer manual CLI check", async () => {
  let release;
  const stale = new Promise((resolve) => { release = resolve; });
  const f = fixture({ api: () => stale, post: async () => info(true) });
  f.panel.render();
  await f.$("platform-cli-check").handlers.click({ currentTarget: f.$("platform-cli-check") });
  assert.equal(f.$("platform-cli-enable").hidden, false);
  release(info(false)); await tick();
  assert.equal(f.$("platform-cli-enable").hidden, false);
  assert.match(f.$("platform-cli-status").html, /已授权/);
});
