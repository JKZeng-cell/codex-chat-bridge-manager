import { createCodexRunner } from "./codexRunner.js";
import { getCodexFailureMessage } from "./codexErrors.js";
import { createPlatformAdapter } from "./platformAdapters.js";
import { createThreadStore } from "./threadStore.js";
import { applyCompressedContext } from "./sessionCompression.js";
import { TaskQueue } from "./taskQueue.js";

export function createPlatformRuntime(config, options = {}) {
  const runner = options.runner || createCodexRunner(config);
  const store = options.store || createThreadStore(config.runtime.sessionThreadStorePath);
  const queue = new TaskQueue(config.runtime.maxConcurrentJobs);
  const chains = new Map();
  const seen = new Set();
  let outstanding = 0;
  let accepting = 0;
  let status = { state: "stopped", startedAt: "", stoppedAt: "", lastError: "", lastMessageAt: "" };
  function onState(state, message = "") {
    status = { ...status, state, ...(state === "running" ? { lastError: "" } : message ? { lastError: message } : {}) };
    options.onStateChange?.({ state, message });
  }
  function onError(error) { options.onLog?.({ level: "error", timestamp: new Date().toISOString(), message: error.message }); }

  async function onMessage(message) {
    accepting += 1;
    try { return await acceptMessage(message); }
    finally { accepting -= 1; }
  }

  async function acceptMessage(message) {
    const { id, chatId, userId, chatType, reply } = message;
    if (!["running", "starting", "error"].includes(status.state) || !id || !chatId || !message.text?.trim()) return;
    if (seen.has(id)) return;
    if (config.bot.platform === "weixin" && config.bot.platformConfig.ownerId && config.bot.platformConfig.ownerId !== userId) return;
    if (config.feishu.allowedChatIds.size && !config.feishu.allowedChatIds.has(chatId)) return;
    if (config.feishu.allowedOpenIds.size && !config.feishu.allowedOpenIds.has(userId)) return;
    let prompt = message.text.trim();
    const prefix = config.feishu.commandPrefix;
    if (prefix && prompt.startsWith(prefix) && (!prompt[prefix.length] || /\s/.test(prompt[prefix.length]))) prompt = prompt.slice(prefix.length).trim();
    else if (chatType !== "p2p" || !config.feishu.allowPlainTextInP2P) return;
    if (!prompt) return;
    const sessionKey = `${chatType}:${chatId}`;
    const createdAt = new Date().toISOString();
    const existing = await store.get(sessionKey);
    if (seen.has(id) || existing?.history?.some((entry) => entry.id === id)) return;
    seen.add(id);
    if (seen.size > 2000) seen.delete(seen.values().next().value);
    status.lastMessageAt = createdAt;
    await store.update(sessionKey, (current) => ({ ...current, sessionKey, chatId, chatType, openId: userId,
      updatedAt: createdAt, history: [...(current?.history || []), { id, createdAt, userPrompt: prompt, status: "queued" }] }));
    outstanding += 1;
    const update = (patch, threadId) => store.update(sessionKey, (current) => ({ ...current,
      ...(threadId ? { threadId } : {}), updatedAt: new Date().toISOString(),
      history: (current?.history || []).map((entry) => entry.id === id ? { ...entry, ...patch } : entry) }));
    const previous = chains.get(sessionKey) || Promise.resolve();
    const task = previous.catch(() => {}).then(() => queue.push(async () => {
      try {
        await update({ status: "running" });
        if (config.bot.platform === "wecom") await reply("收到，正在处理…", false).catch(onError);
        const record = await store.get(sessionKey);
        const skills = config.bot.preferredSkills || [];
        const skillContext = skills.length ? "Prefer these installed skills when relevant:\n" + skills.join("\n") + "\n\n" : "";
        const result = await runner.run({ prompt: skillContext + applyCompressedContext(prompt, record),
          messageId: id, resumeSessionId: config.feishu.sessionThreadsEnabled ? record?.threadId : undefined });
        await update({ status: "completed", completedAt: new Date().toISOString(), responseText: result.message,
          responseSummary: (result.message || "").slice(0, 320), durationMs: result.durationMs }, result.threadId);
        try { await reply(result.message || "已完成"); }
        catch (error) { await update({ deliveryError: error.message }); onError(error); }
      } catch (error) {
        const detail = (error.details && getCodexFailureMessage(error.details)) || error.message;
        await update({ status: "failed", completedAt: new Date().toISOString(), errorText: detail });
        await reply("执行未完成：" + detail.slice(0, 1500)).catch(onError);
        onError(error);
      }
    }));
    chains.set(sessionKey, task);
    void task.catch(onError).finally(() => { outstanding -= 1; if (chains.get(sessionKey) === task) chains.delete(sessionKey); });
  }

  const adapter = (options.adapterFactory || createPlatformAdapter)(config, { onState, onMessage, onError });
  return {
    async start() {
      if (["running", "starting"].includes(status.state)) return this.getStatus();
      if (outstanding || accepting) throw new Error("机器人仍有任务执行中，请完成后重新连接");
      await adapter.stop();
      status.lastError = "";
      status.startedAt = new Date().toISOString();
      onState("starting");
      try { await adapter.start(); } catch (error) { onState("error", error.message); throw error; }
      return this.getStatus();
    },
    async stop() {
      if (outstanding || accepting) throw new Error("机器人仍有任务执行中，请完成后断开");
      await adapter.stop(); status.stoppedAt = new Date().toISOString(); onState("stopped");
      return this.getStatus();
    },
    getStatus() { return { ...status, botId: config.bot.id, botName: config.bot.name,
      workdir: config.codex.workdir, model: config.codex.model, logDir: config.runtime.logDir,
      sessionStorePath: config.runtime.sessionThreadStorePath,
      queue: { activeCount: queue.activeCount, pendingCount: Math.max(0, outstanding + accepting - queue.activeCount) } }; }
  };
}
