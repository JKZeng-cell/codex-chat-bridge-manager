import crypto from "node:crypto";
import { splitReply } from "./platformReplies.js";

function replyError(error) {
  const code = Number(error?.errcode);
  return new Error(Number.isFinite(code) ? `企业微信回复失败 (${code})` :
    /timeout/i.test(String(error?.message)) ? "企业微信回复回执超时" : "企业微信回复发送失败");
}

export function createWecomResponder(client, frame, options = {}) {
  const streamId = crypto.randomUUID();
  const chatId = frame.body?.chatid || frame.body?.from?.userid;
  const now = options.now || Date.now;
  const startedAt = now();
  const windowMs = options.streamWindowMs ?? 280000;
  const maxUpdates = options.maxUpdates ?? 80;
  let updates = 0;
  let asynchronous = false;
  let closed = false;

  async function send(operation) {
    let timer;
    try {
      const result = await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("reply timeout")), options.timeoutMs ?? 8000);
      })]);
      if (result?.errcode != null && Number(result.errcode) !== 0) throw result;
      return result;
    } catch (error) { throw replyError(error); }
    finally { clearTimeout(timer); }
  }

  async function push(content) {
    if (!chatId || typeof client.sendMessage !== "function") throw new Error("企业微信无法发送异步结果，请检查机器人消息权限");
    for (const chunk of splitReply(content)) await send(() => client.sendMessage(chatId, {
      msgtype: "markdown", markdown: { content: chunk }
    }));
  }

  return {
    async reply(content, finish = true) {
      const chunks = splitReply(content || "已完成");
      if (!asynchronous && (now() - startedAt >= windowMs || updates >= maxUpdates)) {
        asynchronous = true;
        if (!closed && now() - startedAt < 330000) {
          await send(() => client.replyStream(frame, streamId, "任务仍在处理，完成后会另发结果。", true))
            .catch((error) => options.onError?.(error));
          closed = true;
        }
      }
      if (asynchronous) {
        if (finish) await push(content || "已完成");
        return;
      }
      try {
        await send(() => client.replyStream(frame, streamId, chunks[0], finish));
        updates++;
        closed = finish;
      } catch (error) {
        asynchronous = true;
        if (!finish) throw error;
        options.onError?.(error);
        return push(content || "已完成");
      }
      // A callback owns one stream. Overflow uses independent active messages.
      if (finish && chunks.length > 1) await push(chunks.slice(1).join(""));
    }
  };
}
