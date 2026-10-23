import crypto from "node:crypto";
import path from "node:path";
import { WSClient } from "@wecom/aibot-node-sdk";
import { DWClient, TOPIC_ROBOT } from "dingtalk-stream";
import { readJsonFile, writeJsonFile } from "./fileStore.js";
import { requestJson, trustedWeixinBase, weixinHeaders } from "./platforms.js";
import { splitReply } from "./platformReplies.js";
import { createWecomResponder } from "./wecomReplies.js";

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

  function trustedDingWebhook(webhook) {
    const url = new URL(webhook);
    if (url.protocol !== "https:" || url.hostname !== "oapi.dingtalk.com" || url.username || url.password || url.port) {
      throw new Error("钉钉回复地址不可信");
    }
    return url.href;
  }

  async function dingToken(signal) {
    if (!accessToken || Date.now() >= accessToken.expiresAt) {
      const result = await request("https://api.dingtalk.com/v1.0/oauth2/accessToken", {
        appKey: credentials.appId, appSecret: credentials.appSecret
      }, undefined, signal);
      if (!result.accessToken) throw new Error("钉钉没有返回有效令牌");
      accessToken = { value: result.accessToken, expiresAt: Date.now() + (Number(result.expireIn || 7200) - 60) * 1000 };
    }
    return accessToken.value;
  }

  async function dingReply(webhook, content, signal) {
    const url = trustedDingWebhook(webhook);
    const token = await dingToken(signal);
    for (const chunk of splitReply(content)) {
      await request(url, { msgKey: "sampleText", msgParam: JSON.stringify({ content: chunk }) }, { "x-acs-dingtalk-access-token": token }, signal);
    }
  }

  function dingResponder(msg) {
    const trackId = crypto.randomUUID();
    let created = false;
    let inputting = false;
    let fallback = config.feishu.streamingCardEnabled === false;
    const cardData = (content, flowStatus) => ({ msgContent: content, flowStatus, staticMsgContent: "",
      sys_full_json_obj: JSON.stringify({ order: ["msgContent"] }), config: JSON.stringify({ autoLayout: true }) });
    const cardRequest = async (endpoint, body, method = "POST", signal) => {
      const result = await requestJson("https://api.dingtalk.com/v1.0/card/" + endpoint,
        { method, body: JSON.stringify(body), signal, headers: { "x-acs-dingtalk-access-token": await dingToken(signal) } }, fetcher);
      const rejected = (value, depth = 0) => value && typeof value === "object" && depth < 8 &&
        (value.success === false || Object.values(value).some((entry) => rejected(entry, depth + 1)));
      if (rejected(result) || (result.code != null && !["0", "200", "OK", "Success"].includes(String(result.code)))) {
        throw new Error("钉钉卡片请求被平台拒绝");
      }
      return result;
    };
    return {
      get streamingMode() { return fallback ? "append" : "replace"; },
      async reply(content, finish = true, { failed = false, signal } = {}) {
        trustedDingWebhook(msg.sessionWebhook);
        if (fallback) return dingReply(msg.sessionWebhook, content, signal);
        try {
          if (!created) {
            await cardRequest("instances", {
              cardTemplateId: "02fcf2f4-5e02-4a85-b672-46d1f715543e.schema", outTrackId: trackId,
              cardData: { cardParamMap: cardData(content, "1") }, callbackType: "STREAM",
              imGroupOpenSpaceModel: { supportForward: false }, imRobotOpenSpaceModel: { supportForward: false }
            }, "POST", signal);
            const group = String(msg.conversationType) === "2";
            const spaceId = group ? msg.conversationId : msg.senderStaffId;
            if (!spaceId) throw new Error("钉钉缺少卡片投放目标");
            await cardRequest("instances/deliver", { outTrackId: trackId, userIdType: 1,
              openSpaceId: "dtv1.card//" + (group ? "IM_GROUP." : "IM_ROBOT.") + spaceId,
              ...(group ? { imGroupOpenDeliverModel: { robotCode: credentials.appId } } : {
                imRobotOpenDeliverModel: { spaceType: "IM_ROBOT", robotCode: credentials.appId, extension: { dynamicSummary: "true" } }
              })
            }, "POST", signal);
            created = true;
          }
          if (!inputting) {
            await cardRequest("instances", { outTrackId: trackId,
              cardData: { cardParamMap: cardData(content, "2") }, cardUpdateOptions: { updateCardDataByKey: true } }, "PUT", signal);
            inputting = true;
          }
          try {
            await cardRequest("streaming", { outTrackId: trackId, guid: crypto.randomUUID(), key: "msgContent",
              content, isFull: true, isFinalize: finish, isError: failed }, "PUT", signal);
          } catch (error) {
            if (!finish || signal?.aborted) throw error;
            handlers.onError(new Error("钉钉流式结束失败，正在提交完整正文和最终状态"));
          }
          if (finish) await cardRequest("instances", { outTrackId: trackId,
            cardData: { cardParamMap: cardData(content, failed ? "5" : "3") },
            cardUpdateOptions: { updateCardDataByKey: true } }, "PUT", signal);
        } catch (error) {
          if (signal?.aborted) throw error;
          fallback = true;
          handlers.onError(new Error("钉钉流式卡片不可用，已回退文本；请检查互动卡片和 AI 流式更新权限"));
          await dingReply(msg.sessionWebhook, content, signal);
        }
      }
    };
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
            chatType: "p2p", text, streamingMode: "append", reply: async (content) => {
              for (const chunk of splitReply(content, 1800)) await authenticated("sendmessage", { msg: {
              from_user_id: "", to_user_id: msg.from_user_id, client_id: crypto.randomUUID(),
              message_type: 2, message_state: 2, context_token: msg.context_token,
              item_list: [{ type: 1, text_item: { text: chunk } }]
            } }); } });
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
            const responder = createWecomResponder(client, frame, { ...options.wecomReplyOptions, onError: handlers.onError });
            deliver({ id: body.msgid, userId: body.from?.userid, chatId: body.chatid || body.from?.userid,
              chatType: body.chattype === "group" ? "group" : "p2p", text, streamingMode: "replace",
              reply: (content, finish) => responder.reply(content, finish) });
          });
          client.connect();
        } else if (platform === "dingtalk") {
          client = options.dingtalkFactory?.() || new DWClient({ clientId: credentials.appId, clientSecret: credentials.appSecret, keepAlive: true, autoReconnect: true });
          client.registerCallbackListener(TOPIC_ROBOT, (frame) => {
            if (frame.headers?.messageId) client.socketCallBackResponse(frame.headers.messageId, { success: true });
            try {
              const msg = JSON.parse(frame.data);
              const responder = dingResponder(msg);
              deliver({ id: msg.msgId || frame.headers?.messageId, chatId: msg.conversationId || msg.senderStaffId || msg.senderId,
                userId: msg.senderStaffId || msg.senderId, chatType: String(msg.conversationType) === "2" ? "group" : "p2p",
                text: msg.text?.content, get streamingMode() { return responder.streamingMode; },
                reply: (...args) => responder.reply(...args) });
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
