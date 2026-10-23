import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createTrayController } from "../electron/tray.js";
import { isInstallerQuitRequest } from "../electron/desktop-policy.js";

function setup(options = {}) {
  const calls = [];
  const icon = new EventEmitter();
  let dead = false;
  let quitting = false;
  let minimized = false;
  icon.isDestroyed = () => dead;
  icon.destroy = () => { dead = true; calls.push("destroy"); };
  icon.setToolTip = () => {};
  icon.setContextMenu = value => { icon.menu = value; };
  const win = {
    isDestroyed: () => false, isMinimized: () => minimized,
    restore: () => { minimized = false; calls.push("restore"); },
    show: () => calls.push("show"), focus: () => calls.push("focus"), hide: () => calls.push("hide")
  };
  const controller = createTrayController({
    createTray: () => icon, buildMenu: items => items, icon: "test.ico",
    getWindow: () => win, isQuitting: () => quitting,
    quit: () => calls.push("quit"), onHidden: () => calls.push("notice"),
    onError: () => calls.push("error"), ...options
  });
  return { controller, calls, icon, win, quitting: () => { quitting = true; }, minimize: () => { minimized = true; } };
}

test("closing the window hides to tray without quitting and notifies only once", () => {
  const { controller, calls } = setup();
  assert.equal(controller.start(), true);
  const event = { preventDefault: () => calls.push("prevent") };
  controller.close(event);
  controller.close(event);
  assert.deepEqual(calls, ["prevent", "hide", "notice", "prevent", "hide"]);
});

test("tray click and double click restore the existing minimized window", () => {
  const { controller, calls, icon, minimize } = setup();
  controller.start();
  minimize();
  icon.emit("click");
  icon.emit("double-click");
  assert.deepEqual(calls, ["restore", "show", "focus", "show", "focus"]);
});

test("tray menu provides restore, background and explicit protected quit actions", () => {
  const { controller, calls, icon } = setup();
  controller.start();
  icon.menu[0].click();
  icon.menu[1].click();
  icon.menu[3].click();
  assert.deepEqual(calls, ["show", "focus", "hide", "notice", "quit"]);
  assert.equal(controller.available(), true, "Keep tray until real app exit, including blocked quit");
});

test("real shutdown allows window close and never hides the window again", () => {
  const { controller, calls, quitting } = setup();
  controller.start();
  quitting();
  controller.close({ preventDefault: () => calls.push("prevent") });
  assert.equal(controller.hide(), false);
  controller.show();
  assert.deepEqual(calls, []);
  controller.destroy();
  controller.destroy();
  assert.deepEqual(calls, ["destroy"]);
});

test("failed tray creation falls back to normal exit instead of invisible background service", () => {
  const { controller, calls } = setup({ createTray: () => { throw new Error("unavailable"); } });
  assert.equal(controller.start(), false);
  controller.close({ preventDefault: () => calls.push("prevent") });
  assert.deepEqual(calls, ["error", "prevent", "quit"]);
});

test("destroyed tray falls back to quit and does not hide a window", () => {
  const { controller, calls } = setup();
  controller.start();
  controller.destroy();
  controller.close({ preventDefault: () => calls.push("prevent") });
  assert.deepEqual(calls, ["destroy", "prevent", "quit"]);
});

test("tray setup is idempotent and a missing window cannot be hidden", () => {
  let created = 0;
  const { controller, calls } = setup({ getWindow: () => null });
  controller.start();
  controller.start();
  controller.show();
  assert.equal(controller.hide(), false);
  assert.deepEqual(calls, []);
  const failed = setup({ createTray: () => { created++; throw new Error("unavailable"); } });
  failed.controller.start();
  assert.equal(created, 1);
});

test("installer quit requires an exact argument, not a substring or unrelated value", () => {
  assert.equal(isInstallerQuitRequest(["app.exe", "--quit-for-update"]), true);
  assert.equal(isInstallerQuitRequest(["app.exe", "--quit-for-update=false"]), false);
  assert.equal(isInstallerQuitRequest(["app.exe"]), false);
});
