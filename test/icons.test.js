import test from "node:test";
import assert from "node:assert/strict";
import { CODEX_OFFICIAL_MARK } from "../src/public/codex-mark.js";
import { icon, mountIcons } from "../src/public/icons.js";
import { PLATFORM_ICONS } from "../src/public/platform-icons.js";

test("Codex connection icon preserves the official mark and adds an independent connection symbol", () => {
  const markup = icon("codex-connect");
  assert.match(markup, /viewBox="0 0 62 40"/);
  assert.ok(markup.includes(CODEX_OFFICIAL_MARK));
  assert.match(markup, /fill="currentColor" stroke="none"/);
  assert.match(markup, /circle cx="51" cy="23"/);
  assert.match(markup, /stroke="currentColor"/);
  assert.match(markup, /aria-hidden="true" focusable="false"/);
  assert.doesNotMatch(markup, /#3370ff|https?:|<script/);
  assert.equal((markup.match(/<svg\b/g) || []).length, 1);
});

test("brand mark mounts through the shared icon renderer", () => {
  const slot = { dataset: { icon: "codex-connect" }, innerHTML: "" };
  mountIcons({ querySelectorAll() { return [slot]; } });
  assert.equal(slot.innerHTML, icon("codex-connect"));
  assert.match(icon("plug"), /viewBox="0 0 24 24"/);
});

test("all platform logos use locally bundled official artwork rather than approximated paths", () => {
  const domains = { feishu: "lf-package-cn.feishucdn.com", wecom: "wwcdn.weixin.qq.com", weixin: "res.wx.qq.com", dingtalk: "gw.alicdn.com" };
  assert.deepEqual(Object.keys(PLATFORM_ICONS).sort(), Object.keys(domains).sort());
  for (const [platform, host] of Object.entries(domains)) {
    const asset = PLATFORM_ICONS[platform];
    assert.equal(new URL(asset.source).hostname, host);
    assert.equal(new URL(asset.page).protocol, "https:");
    assert.ok(asset.dataUrl.startsWith(`data:${asset.mime};base64,`));
    const data = Buffer.from(asset.dataUrl.split(",")[1], "base64");
    if (asset.mime === "image/png") assert.equal(data.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    else if (asset.mime === "image/x-icon") assert.equal(data.subarray(0, 4).toString("hex"), "00000100");
    else {
      assert.match(data.toString("utf8"), /<svg\b/);
      assert.doesNotMatch(data.toString("utf8"), /<script\b|<foreignObject\b|\son[a-z]+\s*=/i);
    }
    const markup = icon("platform-" + platform);
    assert.match(markup, /^<img class="icon platform-icon"/);
    assert.ok(markup.includes(asset.dataUrl));
    assert.doesNotMatch(markup, /<path|src="https?:/);
  }
});
