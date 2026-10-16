import { app, BrowserWindow, Menu, dialog, shell, session } from "electron";
import fs from "node:fs/promises";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { loadManagerConfig } from "../src/config.js";
import { createManagerServer } from "../src/managerServer.js";
import { desktopPaths, isAppNavigation, isExternalWebLink } from "./desktop-policy.js";

const smoke = process.argv.includes("--smoke-test");
const argument = (name) => process.argv.find((value) => value.startsWith(name + "="))?.slice(name.length + 1);
const dataDirectory = smoke ? argument("--smoke-data") : path.join(app.getPath("appData"), "CodexChatBridgeManager");
if (!dataDirectory || !path.isAbsolute(dataDirectory)) throw new Error("Desktop data directory must be absolute.");
mkdirSync(dataDirectory, { recursive: true });
app.setPath("userData", dataDirectory);
app.setName("Codex Chat Bridge Manager");
let win;
let server;
let quitting = false;
let shutdownPending = false;
let loginChild;
const acquired = app.requestSingleInstanceLock();
if (!acquired) app.quit();
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });

async function openExternal(value) {
  if (!isExternalWebLink(value)) return;
  const host = new URL(value).hostname;
  const answer = await dialog.showMessageBox(win, { type: "question", title: "打开外部链接", message: "在浏览器打开外部网站？", detail: host, buttons: ["打开", "取消"], defaultId: 1, cancelId: 1 });
  if (answer.response === 0) await shell.openExternal(value);
}

async function smokeTest(paths, origin) {
  await win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{let n=0;const timer=setInterval(()=>{if(document.querySelector('#connection-label')?.textContent==='本地服务已连接'){clearInterval(timer);resolve(true)}else if(++n>100){clearInterval(timer);reject(new Error('Frontend startup timeout'))}},100)})`);
  const result = await win.webContents.executeJavaScript(`(async()=>{const overview=await(await fetch('/api/overview')).json();document.querySelector('[data-view="system"]').click();return {title:document.title,bots:overview.bots.length,theme:document.documentElement.dataset.theme,version:overview.system.nodeVersion,host:location.hostname,systemVisible:!document.querySelector('#view-system').hidden,hasNode:typeof window.require!=='undefined',iconButtons:[...document.querySelectorAll('.bot-actions button')].every(b=>!b.textContent.trim()&&b.getAttribute('aria-label'))}})()`);
  const binary = (file) => new Promise((resolve, reject) => {
    const child = spawn(file, ["--version"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(output.trim()) : reject(new Error("Bundled binary failed")));
  });
  result.codex = await binary(paths.codex);
  result.feishuCli = await binary(paths.cli);
  result.appVersion = app.getVersion();
  result.health = await win.webContents.executeJavaScript(`(async()=>{const overview=await(await fetch('/api/overview')).json();const codex=await(await fetch('/api/codex/status',{method:'POST'})).json();return {managerState:overview.system.state,codexState:codex.state,codexVersion:codex.version,codexCheckedAt:codex.checkedAt,healthCards:document.querySelectorAll('.health-surface').length,footer:document.querySelector('.app-footer')?.textContent}})()`);
  result.userData = app.getPath("userData");
  result.origin = origin;
  result.packaged = app.isPackaged;
  if (result.hasNode || result.bots !== 0 || !result.systemVisible) throw new Error("Desktop isolation smoke failed.");
  if (result.health.managerState !== "running" || result.health.healthCards !== 2 || !result.health.codexCheckedAt || !result.codex.includes(result.health.codexVersion) || !result.health.codexVersion || result.health.footer !== "Powered by JKZeng") throw new Error("Desktop system status smoke failed.");
  const report = argument("--smoke-report");
  if (report) {
    await fs.writeFile(report, JSON.stringify(result, null, 2));
    await fs.writeFile(report + ".png", (await win.webContents.capturePage()).toPNG());
  }
  console.log("Desktop smoke passed", JSON.stringify(result));
  app.quit();
}

if (acquired) app.whenReady().then(async () => {
  const data = app.getPath("userData");
  const paths = desktopPaths(data, app.isPackaged ? process.resourcesPath : app.getAppPath(), app.isPackaged);
  for (const dir of [data, paths.state, paths.logs, paths.workdir, path.dirname(paths.cli)]) await fs.mkdir(dir, { recursive: true });
  try { await fs.copyFile(paths.bundledCli, paths.cli, 1); } catch (error) { if (error.code !== "EEXIST") throw error; }
  process.chdir(data);
  const config = loadManagerConfig();
  config.manager = { host: "127.0.0.1", port: smoke ? 0 : 3211 };
  config.feishu = { ...config.feishu, appId: "", appSecret: "", cliBin: paths.cli };
  config.cli = { ...config.cli, bin: paths.cli, configDir: path.join(paths.state, "lark-cli-workconfig") };
  config.codex = { ...config.codex, cliMode: "global", cliBin: paths.codex, model: "", workdir: paths.workdir };
  config.runtime = { ...config.runtime, stateDir: paths.state, logDir: paths.logs, managerStateDir: path.join(paths.state, "manager"), botsStateDir: path.join(paths.state, "bots"), feishuAttachmentDir: path.join(paths.state, "attachments"), sessionThreadStorePath: path.join(paths.state, "sessions.json") };
  server = createManagerServer(config);
  await server.start();
  const origin = "http://127.0.0.1:" + server.getAddress().port;
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === "clipboard-sanitized-write" && isAppNavigation(_contents.getURL(), origin)));
  session.defaultSession.setPermissionCheckHandler((contents, permission) => permission === "clipboard-sanitized-write" && Boolean(contents) && isAppNavigation(contents.getURL(), origin));
  session.defaultSession.webRequest.onHeadersReceived({ urls: [origin + "/*"] }, (details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' https://cdn.openai.com; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'"] } });
  });
  win = new BrowserWindow({ width: 1440, height: 1000, minWidth: 880, minHeight: 640, show: false, title: "Codex 连接", backgroundColor: "#171717", icon: app.isPackaged ? path.join(process.resourcesPath, "icon.png") : path.join(app.getAppPath(), "build", "icon.png"), webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, spellcheck: false } });
  win.webContents.setWindowOpenHandler(({ url }) => { void openExternal(url); return { action: "deny" }; });
  win.on("close", (event) => { if (!quitting) { event.preventDefault(); app.quit(); } });
  win.webContents.on("will-navigate", (event, url) => { if (!isAppNavigation(url, origin)) { event.preventDefault(); void openExternal(url); } });
  const login = () => {
    if (loginChild) return;
    loginChild = spawn(paths.codex, ["login"], { windowsHide: true, stdio: "ignore" });
    loginChild.once("error", () => { loginChild = null; void dialog.showMessageBox(win, { type: "error", message: "无法启动 Codex 登录" }); });
    loginChild.once("close", (code) => { loginChild = null; void dialog.showMessageBox(win, { type: code === 0 ? "info" : "warning", message: code === 0 ? "Codex 登录完成" : "Codex 登录未完成，请检查网络并重试" }); });
    void dialog.showMessageBox(win, { message: "请在浏览器中完成 Codex 登录", detail: "官方 Codex CLI 将打开授权页面。不会复制或上传你已有的本机凭据。" });
  };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "应用", submenu: [{ label: "Codex 登录", click: login }, { label: "打开应用数据目录", click: () => { void shell.openPath(data); } }, { type: "separator" }, { role: "quit", label: "退出" }] },
    { label: "编辑", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    { label: "视图", submenu: [{ role: "reload", label: "刷新" }, { role: "resetZoom", label: "实际大小" }, { role: "zoomIn", label: "放大" }, { role: "zoomOut", label: "缩小" }, { role: "togglefullscreen", label: "全屏" }] }
  ]));
  win.once("ready-to-show", () => { if (!smoke) win.show(); });
  await win.loadURL(origin);
  if (smoke) await smokeTest(paths, origin);
}).catch(async (error) => {
  if (smoke) { const report = argument("--smoke-report"); if (report) await fs.writeFile(report, JSON.stringify({ error: error.message })); }
  else dialog.showErrorBox("应用启动失败", error.message);
  app.exit(1);
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", (event) => {
  if (quitting || !server) return;
  event.preventDefault();
  if (shutdownPending) return;
  shutdownPending = true;
  void (async () => {
    const overview = await (await fetch("http://127.0.0.1:" + server.getAddress().port + "/api/overview")).json();
    if (overview.bots.some(({ service }) => service.queue.activeCount || service.queue.pendingCount) || overview.maintenance?.state === "running") {
      if (win?.isDestroyed()) win = null;
      await dialog.showMessageBox({ type: "warning", message: "仍有任务执行中", detail: "请等待任务或工具更新完成后，再退出应用。服务仍在后台运行。" });
      shutdownPending = false;
      return;
    }
    quitting = true;
    loginChild?.kill();
    await server.stop();
    app.quit();
  })().catch((error) => { console.error(error); app.exit(1); });
});
