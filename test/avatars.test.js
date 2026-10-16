import test from "node:test";
import assert from "node:assert/strict";
import { AVATARS, createAvatarPreferences, normalizeAvatar, renderAvatar } from "../src/public/avatars.js";

function storageFixture() {
  const values = new Map();
  return { getItem(key) { return values.get(key) ?? null; }, setItem(key, value) { values.set(key, value); } };
}

test("avatar catalog contains sixteen unique local vector designs", () => {
  assert.equal(AVATARS.length, 16);
  assert.equal(new Set(AVATARS.map((avatar) => avatar.id)).size, 16);
  for (const avatar of AVATARS) {
    assert.ok(avatar.label);
    const html = renderAvatar(avatar.id);
    assert.match(html, /<svg viewBox="0 0 24 24"/);
    assert.ok(html.includes('data-avatar-id="' + avatar.id + '"'));
    assert.doesNotMatch(html, /https?:|<script|<foreignObject|\son\w+=/i);
  }
});

test("unrecognized or malicious avatar IDs use the safe default", () => {
  for (const input of [null, undefined, "", "unknown", '"><img src=x onerror=alert(1)>', {}]) {
    assert.equal(normalizeAvatar(input), "robot");
    assert.equal(renderAvatar(input), renderAvatar("robot"));
  }
});

test("avatar choices persist across instances and remain independent per bot", () => {
  const storage = storageFixture();
  const preferences = createAvatarPreferences(storage);
  assert.equal(preferences.get("one"), "robot");
  assert.equal(preferences.set("one", "cat"), true);
  assert.equal(preferences.set("two", "rocket"), true);
  const restored = createAvatarPreferences(storage);
  assert.equal(restored.get("one"), "cat");
  assert.equal(restored.get("two"), "rocket");
  assert.equal(restored.get("three"), "robot");
  assert.equal(restored.set("one", "robot"), true);
  assert.equal(preferences.get("one"), "robot");
});

test("corrupted stored choices and invalid writes cannot add arbitrary markup", () => {
  const storage = storageFixture();
  storage.setItem("bridge-avatar:one", "<svg onload=alert(1)>");
  const preferences = createAvatarPreferences(storage);
  assert.equal(preferences.get("one"), "robot");
  preferences.set("one", "<script>");
  assert.equal(storage.getItem("bridge-avatar:one"), "robot");
  assert.equal(preferences.set("", "cat"), false);
  assert.equal(preferences.get(""), "robot");
});

test("blocked storage keeps a session choice and reports that it was not persisted", () => {
  const preferences = createAvatarPreferences({ getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } });
  assert.equal(preferences.get("one"), "robot");
  assert.equal(preferences.set("one", "panda"), false);
  assert.equal(preferences.get("one"), "panda");
  assert.equal(preferences.get("two"), "robot");
});
