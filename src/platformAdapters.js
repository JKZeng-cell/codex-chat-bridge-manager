import crypto from "node:crypto";
import path from "node:path";
import { WSClient } from "@wecom/aibot-node-sdk";
import { DWClient, TOPIC_ROBOT } from "dingtalk-stream";
import { readJsonFile, writeJsonFile } from "./fileStore.js";
import { requestJson, trustedWeixinBase, weixinHeaders } from "./platforms.js";

export function createPlatformAdapter(config, handlers, options = {}) {
  const platform = config.bot.platform;
  const credentials = config.feishu;
  const fetcher = options.fetch || fetch;
  let client;
  let timer;
  let controller;
  let polling;
  let stopped = true;
  let accessToken;
  const request = (url, body, headers, signal) => requestJson(url, {
    method: "POST", body: JSON.stringify(body), headers, signal
  }, fetcher);
  const state = (value, message = "") => { if (!stopped) handlers.onState(value, message); };
  const deliver = (message) => { if (!stopped) void handlers.onMessage(message).catch((error) => handlers.onError(error)); };

  async function dingReply(webhook, content) {
    const url = new URL(webhook);
    if (url.protocol !== "https:" || url.hostname !== "oapi.dingtalk.com" || url.username || url.password || url.port) {
      throw new Error("钉钉回复地址不可信");
    }
    if (!accessToken || Date.now() >= accessToken.expiresAt) {
      const result = await request("https://api.dingtalk.com/v1.0/oauth2/accessToken", {
        appKey: credentials.appId, appSecret: credentials.appSecret
      });
      if (!result.accessToken) throw new Error("钉钉没有返回有效令牌");
      accessToken = { value: result.accessToken, expiresAt: Date.now() + (Number(result.expireIn || 7200) - 60) * 1000 };
    }
    await request(url.href, { msgtype: "text", text: { content: content.slice(0, 18000) } }, { "x-acs-dingtalk-access-token": accessToken.value });
  }

  async function weixinLoop(signal) {
    const base = trustedWeixinBase(config.bot.platformConfig.baseUrl);
    const cursorPath = path.join(path.dirname(config.runtime.sessionThreadStorePath), "weixin-cursor.json");
    let cursor = (await readJsonFile(cursorPath, {})).cursor || "";
    const authenticated = async (endpoint, body, abort = AbortSignal.any([signal, AbortSignal.timeout(25000)])) => request(base + "/ilink/bot/" + endpoint,
      { ...body, base_info: { channel_version: "1.0.2" } },
      { ...weixinHeaders(), Authorization: "Bearer " + credentials.appSecret }, abort);
    while (!signal.aborted) {
      try {
        const result = await authenticated("getupdates", { get_updates_buf: cursor }, AbortSignal.any([signal, AbortSignal.timeout(40000)]));
        if (signal.aborted) break;
        state("running");
        for (const msg of result.msgs || []) {
          if (msg.message_type !== 1 || !msg.from_user_id || !msg.message_id) continue;
          const text = (msg.item_list || []).map((item) => item.type === 1 ? item.text_item?.text || "" : "").join("\n").trim();
          if (!text) continue;
          // Queue acceptance precedes cursor persistence so restarts do not lose unaccepted messages.
          await handlers.onMessage({ id: String(msg.message_id), chatId: msg.from_user_id, userId: msg.from_user_id,
            chatType: "p2p", text, reply: (content) => authenticated("sendmessage", { msg: {
              from_user_id: "", to_user_id: msg.from_user_id, client_id: crypto.randomUUID(),
              message_type: 2, message_state: 2, context_token: msg.context_token,
              item_list: [{ type: 1, text_item: { text: content.slice(0, 18000) } }]
            } }) });
        }
        cursor = result.get_updates_buf || cursor;
        await writeJsonFile(cursorPath, { cursor });
        if (!(result.msgs || []).length) await new Promise((resolve) => setTimeout(resolve, 300));
      } catch (error) {
        if (signal.aborted) break;
        state("error", error.message);
        if (/平台接口错误 -1[34]/.test(error.message)) break;
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  }

  return {
    async start() {
      if (!stopped) return;
      stopped = false;
      try {
        if (platform === "wecom") {
          client = options.wecomFactory?.() || new WSClient({ botId: credentials.appId, secret: credentials.appSecret,
            maxReconnectAttempts: -1, maxAuthFailureAttempts: 5,
            logger: { debug() {}, info() {}, warn() {}, error() {} } });
          client.on("authenticated", () => state("running"));
          client.on("reconnecting", () => state("starting"));
          client.on("disconnected", () => state("error", "企业微信连接已断开"));
          client.on("error", (error) => state("error", String(error?.message || "企业微信连接异常")));
          client.on("message", (frame) => {
            const body = frame.body || {};
            const text = body.text?.content || body.voice?.content || (body.mixed?.msg_item || []).map((item) => item.text?.content || "").join("\n");
            const streamId = crypto.randomUUID();
            deliver({ id: body.msgid, userId: body.from?.userid, chatId: body.chatid || body.from?.userid,
              chatType: body.chattype === "group" ? "group" : "p2p", text,
              reply: (content, finish = true) => client.replyStream(frame, streamId, content.slice(0, 18000), finish) });
          });
          client.connect();
        } else if (platform === "dingtalk") {
          client = options.dingtalkFactory?.() || new DWClient({ clientId: credentials.appId, clientSecret: credentials.appSecret, keepAlive: true, autoReconnect: true });
          client.registerCallbackListener(TOPIC_ROBOT, (frame) => {
            if (frame.headers?.messageId) client.socketCallBackResponse(frame.headers.messageId, { success: true });
            try {
              const msg = JSON.parse(frame.data);
              deliver({ id: msg.msgId || frame.headers?.messageId, chatId: msg.conversationId || msg.senderStaffId || msg.senderId,
                userId: msg.senderStaffId || msg.senderId, chatType: String(msg.conversationType) === "2" ? "group" : "p2p",
                text: msg.text?.content, reply: (content) => dingReply(msg.sessionWebhook, content) });
            } catch (error) { handlers.onError(error); }
          });
          await client.connect();
          state(client.connected ? "running" : "starting");
          timer = setInterval(() => state(client.connected ? "running" : "starting"), 1000);
          timer.unref();
        } else {
          controller = new AbortController();
          polling = weixinLoop(controller.signal).catch((error) => state("error", error.message));
        }
      } catch (error) { await this.stop(); throw error; }
    },
    async stop() { stopped = true; clearInterval(timer); controller?.abort(); client?.disconnect(); client = null; await polling; }
  };
}
