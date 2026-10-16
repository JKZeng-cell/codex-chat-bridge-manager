import test from "node:test";
import assert from "node:assert/strict";
import { resolveTheme, initializeTheme } from "../src/public/theme.js";

test("appearance resolves light, dark, and system themes", () => {
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("dark", false), "dark");
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
  assert.equal(resolveTheme("invalid", true), "light");
});

test("appearance persists selection and tracks system changes only in system mode", () => {
  let change;
  let systemChange;
  let saved = "dark";
  const select = { value: "", addEventListener(_event, listener) { change = listener; } };
  const doc = { documentElement: { dataset: {} }, getElementById() { return select; } };
  const media = { matches: false, addEventListener(_event, listener) { systemChange = listener; } };
  initializeTheme(doc, { getItem() { return saved; }, setItem(_key, value) { saved = value; } }, media);
  assert.equal(doc.documentElement.dataset.theme, "dark");
  select.value = "system"; change();
  assert.equal(saved, "system");
  assert.equal(doc.documentElement.dataset.theme, "light");
  media.matches = true; systemChange();
  assert.equal(doc.documentElement.dataset.theme, "dark");
  select.value = "light"; change(); systemChange();
  assert.equal(doc.documentElement.dataset.theme, "light");
});

test("unavailable appearance storage does not break startup", () => {
  const doc = { documentElement: { dataset: {} }, getElementById() { return null; } };
  initializeTheme(doc, { getItem() { throw new Error("disabled"); } }, { matches: false, addEventListener() {} });
  assert.equal(doc.documentElement.dataset.theme, "light");
});
