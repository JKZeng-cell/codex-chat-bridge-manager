import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import QRCode from "qrcode";
import { resolveCliSecret } from "./cliSecret.js";
import { buildFeishuCliSpawn } from "./feishuCli.js";
import { assertPlatform, PLATFORMS, requestJson, trustedWeixinBase, weixinHeaders } from "./platforms.js";

const ACTIVE = new Set(["starting", "waiting", "scanned", "binding"]);

export function createBindingManager(config, botStore, services, options = {}) {
  const sessions = new Map();
  const fetcher = options.fetch || fetch;
  const spawnProcess = options.spawn || spawn;
  const qr = options.qr || ((url) => QRCode.toDataURL(url, { width: 256, margin: 2 }));
  const now = options.now || Date.now;
  const request = (url, body, headers) => requestJson(url, {
    ...(body ? { method: "POST", body: JSON.stringify(body) } : {}), headers
  }, fetcher);

  function cancelChild(session) {
    const child = session.child;
    session.child = null;
    if (!child?.pid) return;
    if (process.platform === "win32") {
      const killer = spawnProcess("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      killer.on("error", () => child.kill());
    } else child.kill();
  }

  function publicSession(session) {
    if (["starting", "waiting", "scanned"].includes(session.state) && now() >= session.expiresAt) {
      session.state = "expired";
      session.message = "二维码已过期，请重新生成";
      cancelChild(session);
    }
    return { id: session.id, platform: session.platform, state: session.state,
      message: session.message, verificationUrl: session.verificationUrl || "",
      qrDataUrl: session.qrDataUrl || "", expiresAt: session.expiresAt,
      botId: session.botId || "" };
  }

  async function complete(session, credentials) {
    publicSession(session);
    if (!ACTIVE.has(session.state) || session.state === "binding") return;
    if (!credentials.appId || !credentials.appSecret) throw new Error("授权成功但平台没有返回有效机器人凭据");
    const duplicate = (await botStore.list()).find((bot) =>
      (bot.platform || "feishu") === session.platform && bot.appId === credentials.appId);
    if (!ACTIVE.has(session.state)) return;
    session.state = "binding";
    const bot = duplicate ? await botStore.update(duplicate.id, credentials) : await botStore.save({
      id: session.id, name: session.name, platform: session.platform,
      workdir: config.codex.workdir, autoStart: true, ...credentials
    });
    session.botId = bot.id;
    // A transport connection must not hold the QR poll request open indefinitely.
    session.message = "绑定已完成，正在连接消息服务，请查看机器人卡片";
    session.state = "connected";
    void services.start(bot.id).catch(() => {
      session.message = "绑定已保存，消息服务暂未连接，可在设置中重试";
    });
  }

  async function startFeishu(session) {
    const configDir = path.join(config.runtime.managerStateDir, "bindings", session.id);
    await fs.mkdir(configDir, { recursive: true });
    if (!ACTIVE.has(session.state)) return;
    const invocation = buildFeishuCliSpawn(["config", "init", "--new", "--name", "bridge", "--lang", "zh_cn"], { cliBin: config.cli.bin });
    const child = spawnProcess(invocation.command, invocation.args, {
      windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, LARKSUITE_CLI_CONFIG_DIR: configDir,
        LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1", LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1" }
    });
    session.child = child;
    let output = "";
    const capture = (chunk) => {
      output = (output + chunk.toString()).slice(-16000);
      const url = output.match(/https:\/\/(?:accounts|open)\.(?:feishu|larksuite)\.[^\s"'<>\x1b]+/)?.[0];
      if (!url || session.verificationUrl || !ACTIVE.has(session.state)) return;
      session.verificationUrl = url;
      session.state = "waiting";
      session.message = "使用飞书扫码，按引导创建机器人并确认权限";
      void qr(url).then((value) => { session.qrDataUrl = value; }).catch(() => {});
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    child.on("error", () => { if (ACTIVE.has(session.state)) { session.state = "error"; session.message = "无法启动飞书 CLI，请检查安装状态"; } });
    child.on("close", (code) => {
      session.child = null;
      if (!ACTIVE.has(session.state)) return;
      if (code !== 0) { session.state = "error"; session.message = "飞书授权未完成，请重试或手动接入"; return; }
      void (async () => {
        const saved = JSON.parse(await fs.readFile(path.join(configDir, "config.json"), "utf8"));
        const app = saved.apps?.find((entry) => entry.name === "bridge") || saved.apps?.[0];
        await complete(session, { appId: app?.appId, appSecret: await (options.resolveSecret || resolveCliSecret)(app) });
      })().catch(() => { session.state = "error"; session.message = "未能读取授权凭据，请重新绑定"; });
    });
  }

  async function initialize(session) {
    if (session.platform === "feishu") return startFeishu(session);
    let value;
    if (session.platform === "wecom") {
      value = await request("https://work.weixin.qq.com/ai/qc/generate?source=wecom-cli&plat=2");
      session.code = value.data?.scode;
      session.verificationUrl = value.data?.auth_url;
    } else if (session.platform === "dingtalk") {
      const init = await request("https://oapi.dingtalk.com/app/registration/init", { source: "DING_DWS_CLAW" });
      if (!init.nonce) throw new Error("钉钉没有返回授权标识");
      value = await request("https://oapi.dingtalk.com/app/registration/begin", { nonce: init.nonce });
      session.code = value.device_code;
      session.verificationUrl = value.verification_uri_complete;
      session.expiresAt = now() + Math.min(7200, Math.max(60, Number(value.expires_in) || 7200)) * 1000;
    } else {
      value = await request("https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3", { base_info: { channel_version: "1.0.2" } }, weixinHeaders());
      session.code = value.qrcode;
      session.verificationUrl = value.qrcode_img_content;
    }
    if (!session.code || !session.verificationUrl) throw new Error("平台没有返回有效二维码，请稍后重试");
    const uri = new URL(session.verificationUrl);
    if (uri.protocol !== "https:") throw new Error("平台返回的授权链接无效");
    const qrDataUrl = await qr(session.verificationUrl);
    if (session.state !== "starting") return;
    session.qrDataUrl = qrDataUrl;
    session.state = "waiting";
    session.message = `请使用${PLATFORMS[session.platform].name}扫码并确认授权`;
  }

  async function poll(session) {
    publicSession(session);
    if (!["waiting", "scanned"].includes(session.state) || session.platform === "feishu") return;
    let value;
    let result;
    if (session.platform === "wecom") {
      value = await request("https://work.weixin.qq.com/ai/qc/query_result?scode=" + encodeURIComponent(session.code));
      result = String(value.data?.status ?? "").trim().toLowerCase();
      if (result === "success") return complete(session, { appId: value.data.bot_info?.botid, appSecret: value.data.bot_info?.secret });
    } else if (session.platform === "dingtalk") {
      value = await request("https://oapi.dingtalk.com/app/registration/poll", { device_code: session.code });
      result = String(value.status || "").toLowerCase();
      if (result === "success") return complete(session, { appId: value.client_id, appSecret: value.client_secret });
    } else {
      value = await request("https://ilinkai.weixin.qq.com/ilink/bot/get_qrcode_status?qrcode=" + encodeURIComponent(session.code), null, weixinHeaders());
      result = String(value.status || "").toLowerCase();
      if (result === "confirmed") return complete(session, {
        appId: value.ilink_bot_id, appSecret: value.bot_token,
        platformConfig: { baseUrl: trustedWeixinBase(value.baseurl || value.base_url), ownerId: String(value.ilink_user_id || "") }
      });
    }
    if (!ACTIVE.has(session.state)) return;
    if (["expired", "timeout"].includes(result)) { session.state = "expired"; session.message = "二维码已过期，请重新生成"; }
    else if (["scaned", "scanned"].includes(result)) { session.state = "scanned"; session.message = "已扫码，请在手机上确认绑定"; }
    else if (session.platform === "wecom") {
      if (["denied", "rejected", "cancelled", "canceled"].includes(result)) {
        session.state = "error";
        session.message = "企业微信授权已取消或被拒绝，请确认后重新绑定";
      } else if (["failed", "error"].includes(result)) {
        session.state = "error";
        session.message = "企业微信授权未完成，请按手机提示检查权限后重试";
      } else if (result && !["init", "wait", "waiting", "pending"].includes(result)) {
        // Unrecognized intermediate states are not evidence of denied authorization.
        session.message = "正在等待企业微信确认，请在手机上继续完成授权";
      }
    }
    else if (result && !["wait", "waiting", "pending"].includes(result)) {
      session.state = "error";
      session.message = "平台需要额外验证或拒绝了授权，请在手机上完成验证后重新绑定";
    }
  }

  const expiry = setInterval(() => {
    for (const [id, session] of sessions) {
      publicSession(session);
      if (!ACTIVE.has(session.state) && now() > session.expiresAt + 600000) sessions.delete(id);
    }
  }, 10000);
  expiry.unref();

  return {
    start({ platform, name }) {
      assertPlatform(platform);
      if ([...sessions.values()].filter((s) => ACTIVE.has(publicSession(s).state)).length >= 4) throw new Error("请先完成或取消正在进行的绑定");
      const session = { id: crypto.randomUUID(), platform, name: String(name || `${PLATFORMS[platform].name}助手`).trim().slice(0, 80),
        state: "starting", message: "正在获取授权二维码", expiresAt: now() + (platform === "wecom" ? 300000 : 600000) };
      sessions.set(session.id, session);
      void initialize(session).catch((error) => {
        if (ACTIVE.has(session.state)) { session.state = "error"; session.message = error.message; }
      });
      return publicSession(session);
    },
    async get(id, refresh = false) {
      const session = sessions.get(id);
      if (!session) throw new Error("绑定会话已失效，请重新发起");
      if (refresh && !session.polling) {
        session.polling = poll(session).finally(() => { session.polling = null; });
      }
      if (session.polling) await session.polling;
      return publicSession(session);
    },
    cancel(id) {
      const session = sessions.get(id);
      if (session && session.state !== "connected" && session.state !== "binding") {
        session.state = "cancelled"; session.message = "绑定已取消"; cancelChild(session);
      }
      return session ? publicSession(session) : { state: "cancelled" };
    },
    isActive() { return [...sessions.values()].some((session) => ACTIVE.has(publicSession(session).state)); },
    close() { clearInterval(expiry); for (const session of sessions.values()) { session.state = "cancelled"; cancelChild(session); } }
  };
}
