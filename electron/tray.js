export function createTrayController({ createTray, buildMenu, icon, getWindow, isQuitting, quit, onHidden = () => {}, onError = () => {} }) {
  let tray;
  let notified = false;
  const available = () => Boolean(tray && !tray.isDestroyed());
  const window = () => { const value = getWindow(); return value && !value.isDestroyed() ? value : null; };
  function show() {
    const win = window();
    if (!win || isQuitting()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
  function hide() {
    const win = window();
    if (!win || !available() || isQuitting()) return false;
    win.hide();
    if (!notified) {
      notified = true;
      try { onHidden(tray); } catch (error) { onError(error); }
    }
    return true;
  }
  return {
    available, show, hide,
    start() {
      if (available()) return true;
      try {
        tray = createTray(icon);
        tray.setToolTip("Codex 连接 · 后台服务");
        tray.setContextMenu(buildMenu([
          { label: "打开工作台", click: show },
          { label: "最小化到托盘", click: hide },
          { type: "separator" },
          { label: "退出", click: quit }
        ]));
        tray.on("click", show);
        tray.on("double-click", show);
        return true;
      } catch (error) {
        if (tray && !tray.isDestroyed()) tray.destroy();
        tray = null;
        onError(error);
        return false;
      }
    },
    close(event) {
      if (isQuitting()) return;
      event.preventDefault();
      if (!hide()) quit();
    },
    destroy() {
      if (available()) tray.destroy();
      tray = null;
    }
  };
}
