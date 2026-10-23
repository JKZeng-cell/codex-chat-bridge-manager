import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import crypto from "node:crypto";
import QRCode from "qrcode";
import { PLATFORM_CLIS, platformCliDirectory, platformCliEnvironment, platformCliVersion, resolvePlatformCli, supportsPlatformCli } from "./platformCli.js";
import { listSkills } from "./skillRegistry.js";

export function safeCliAuthorizationUrl(text, platform) {
  const clean = String(text).replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
  for (const value of clean.match(/https:\/\/[^\s<>"'\x1b]+/g) || []) {
    try {
      const url = new URL(value);
      const domain = platform === "dingtalk" ? "dingtalk.com" : "weixin.qq.com";
      if (!url.username && !url.password && !url.port && (url.hostname === domain || url.hostname.endsWith("." + domain)) &&
          /oauth|auth|login|device|qrcode/i.test(url.pathname)) return url.href;
    } catch { /* Ignore incomplete lines while the CLI is still writing. */ }
  }
  return "";
}

export function parseCliAuthorization(platform, stdout) {
  if (platform === "wecom") {
    const status = stdout.trim();
    if (!["authorized", "unauthorized"].includes(status)) throw new Error("CLI 未返回可识别的授权状态");
    return status === "authorized";
  }
  let payload;
  try { payload = JSON.parse(stdout); } catch { throw new Error("CLI 未返回可识别的授权状态"); }
  if (payload.reason || payload.error || typeof payload.authenticated !== "boolean") throw new Error("CLI 登录态无法确认，请重新检测或授权");
  return payload.authenticated;
}

export function createPlatformCliManager(config, options = {}) {
  const launch = options.spawn || spawn;
  const resolve = options.resolve || resolvePlatformCli;
  const tasks = new Map();
  const cache = new Map();
  const checks = new Map();
  const probes = new Set();
  let closed = false;

  function definitionFor(bot) {
    platformCliDirectory(config, bot);
    return PLATFORM_CLIS[bot.platform];
  }
  function execute(bot, binary, args, timeoutMs = 12000) {
    if (closed) return Promise.reject(new Error("管理服务已关闭"));
    const child = launch(binary, args, { cwd: platformCliDirectory(config, bot), env: platformCliEnvironment(config, bot),
      windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    probes.add(child);
    let stdout = "";
    let stderr = "";
    const promise = new Promise((accept, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error("CLI 检测超时，请稍后重试")); }, timeoutMs);
      child.stdout.on("data", (chunk) => { stdout = (stdout + chunk.toString()).slice(-65536); });
      child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-65536); });
      child.once("error", () => { probes.delete(child); clearTimeout(timer); reject(new Error("无法启动 CLI，请检查安装路径")); });
      child.once("close", (code) => {
        probes.delete(child);
        clearTimeout(timer);
        if (code !== 0) reject(new Error("CLI 检测失败，请检查版本、网络或企业权限"));
        else accept({ stdout, stderr });
      });
    });
    return promise;
  }
  async function inspect(bot) {
    const definition = definitionFor(bot);
    const base = { platform: bot.platform, name: definition.name, minimum: definition.minimum,
      installCommand: "npm install -g " + definition.package, docs: definition.docs,
      configDir: platformCliDirectory(config, bot), installed: false, supported: false, authorized: false, state: "missing", version: "" };
    try {
      const settings = config.platformClis?.[bot.platform] || {};
      const binary = resolve(bot.platform, settings);
      base.binary = binary;
      base.bundled = Boolean(binary && settings.bundledBin === binary);
      base.skillCount = (await listSkills(config.skills?.bundledRoots || [])).filter((skill) => skill.name.startsWith(bot.platform === "wecom" ? "wecomcli-" : "dingtalk-")).length;
      if (!binary) return settings.bundledOnly ? { ...base, bundled: true, state: "error", message: "内置工具缺失，请更新或修复应用安装包" } : base;
      await fs.mkdir(base.configDir, { recursive: true });
      base.installed = true;
      const { stdout } = await execute(bot, binary, definition.versionArgs);
      base.version = platformCliVersion(stdout);
      base.supported = supportsPlatformCli(base.version, definition.minimum);
      if (!base.supported) return { ...base, state: "outdated", message: base.bundled ? "内置工具版本异常，请更新或修复应用安装包" : "请升级 CLI 后再授权，本工具需要 " + definition.minimum + " 或更新版本" };
      const result = await execute(bot, binary, definition.statusArgs);
      try { base.authorized = parseCliAuthorization(bot.platform, result.stdout); }
      catch { return { ...base, state: "unknown", message: "登录状态尚未确认，可点击授权初始化或修复；不会使用其他账号的登录态" }; }
      return { ...base, state: base.authorized ? "authorized" : "idle", binary };
    } catch (error) { return { ...base, state: "error", message: error.message }; }
  }
  async function status(bot, fresh = false) {
    definitionFor(bot);
    const saved = cache.get(bot.id);
    if (!saved || fresh || Date.now() - saved.time > 30000) {
      if (!checks.has(bot.id)) checks.set(bot.id, inspect(bot).then((value) => {
        cache.set(bot.id, { time: Date.now(), value }); return value;
      }).finally(() => checks.delete(bot.id)));
      await checks.get(bot.id);
    }
    const { binary, ...result } = cache.get(bot.id).value;
    const task = tasks.get(bot.id);
    if (task) {
      const authChanged = !task.running && task.status === "authorized" && !result.authorized;
      let qrDataUrl = task.qrDataUrl || "";
      if (task.running && bot.platform === "wecom") {
        try {
          const stat = await fs.stat(task.qrPath);
          if (stat.size > 0 && stat.size < 512000) {
            const png = await fs.readFile(task.qrPath);
            if (png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) qrDataUrl = "data:image/png;base64," + png.toString("base64");
          }
        } catch { /* The official CLI writes the QR asynchronously. */ }
      }
      return { ...result, authTask: { running: task.running, status: authChanged ? result.state : task.status,
        message: authChanged ? result.message || "当前 CLI 登录态未确认，请重新检测或授权" : task.message,
        verificationUrl: task.running ? task.url : "", qrDataUrl: task.running ? qrDataUrl : "" } };
    }
    return { ...result, authTask: { running: false, status: result.state } };
  }

  return {
    getStatus: status,
    async startAuthorization(bot) {
      if (closed) throw new Error("管理服务已关闭");
      definitionFor(bot);
      if (tasks.get(bot.id)?.running) return status(bot);
      const task = { running: true, status: "starting", message: "正在启动官方 CLI 授权", url: "", qrDataUrl: "" };
      tasks.set(bot.id, task);
      try {
        const info = await status(bot, true);
        if (closed || !task.running) return status(bot);
        if (!info.installed || !info.supported) throw new Error(info.message || "请先安装 CLI，再重新检测");
        const binary = cache.get(bot.id).value.binary;
        task.qrPath = path.join(info.configDir, "authorization-" + crypto.randomUUID() + ".png");
        task.cleanup = () => fs.rm(task.qrPath, { force: true }).catch(() => {});
        const args = bot.platform === "wecom"
          ? ["auth", "init", "--noninteractive", "--no-browser", "--output-qrcode", task.qrPath]
          : ["auth", "login", "--device", "--no-browser", "--recommend", "--format", "json"];
        const child = launch(binary, args, { cwd: info.configDir, env: platformCliEnvironment(config, bot),
          windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
        task.child = child;
        task.status = "waiting_for_authorization";
        task.message = "请使用" + (bot.platform === "wecom" ? "企业微信扫码" : "钉钉打开授权链接") + "完成授权";
        for (const stream of [child.stdout, child.stderr]) {
          let pending = "";
          const decoder = new StringDecoder("utf8");
          stream.on("data", (chunk) => {
            pending = (pending + decoder.write(chunk)).slice(-65536);
            const lines = pending.split(/\r?\n/);
            pending = lines.pop();
            const url = safeCliAuthorizationUrl(lines.join("\n"), bot.platform);
            if (url && !task.url && task.running) {
              task.url = url;
              void QRCode.toDataURL(url, { width: 256, margin: 2 }).then((qr) => { if (task.running) task.qrDataUrl = qr; }).catch(() => {});
            }
          });
        }
        const finish = async (code) => {
          await task.cleanup();
          if (!task.running) return;
          clearTimeout(task.timer);
          task.child = null;
          task.running = false;
          const checked = await status(bot, true);
          if (task.status === "cancelled") return;
          task.status = code === 0 && checked.authorized ? "authorized" : "failed";
          task.message = task.status === "authorized" ? "CLI 授权已确认" : "授权未完成，请检查手机确认、网络和企业权限后重试";
        };
        child.once("error", () => { void finish(1).catch(() => {}); });
        child.once("close", (code) => { void finish(code).catch(() => {}); });
        task.timer = setTimeout(() => {
          if (!task.running) return;
          task.running = false; task.status = "expired"; task.message = "授权已超时，请重试"; child.kill();
          void task.cleanup();
        }, options.authorizationTimeoutMs ?? 300000);
      } catch (error) {
        if (task.running) { task.running = false; task.status = "failed"; task.message = error.message; }
      }
      return status(bot);
    },
    async cancelAuthorization(bot) {
      definitionFor(bot);
      const task = tasks.get(bot.id);
      if (task?.running) {
        task.running = false; task.status = "cancelled"; task.message = "授权已取消，现有凭据未删除";
        clearTimeout(task.timer); task.child?.kill(); task.child = null;
        await task.cleanup?.();
      }
      return status(bot);
    },
    isActive(botId) { return botId ? Boolean(tasks.get(botId)?.running) : [...tasks.values()].some((task) => task.running); },
    close() {
      closed = true;
      for (const child of probes) child.kill();
      for (const task of tasks.values()) {
        task.running = false; task.status = "cancelled"; clearTimeout(task.timer); task.child?.kill();
        void task.cleanup?.();
      }
    }
  };
}
