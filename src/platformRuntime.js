import { createCodexRunner } from "./codexRunner.js";
import { getCodexFailureMessage } from "./codexErrors.js";
import { createPlatformAdapter } from "./platformAdapters.js";
import { createThreadStore } from "./threadStore.js";
import { applyCompressedContext } from "./sessionCompression.js";
import { TaskQueue } from "./taskQueue.js";
import { createPlatformReplies } from "./platformReplies.js";
import { platformCliPrompt } from "./platformCli.js";
import { createPlatformCliManager } from "./platformCliManager.js";

export function createPlatformRuntime(config, options = {}) {
  const runner = options.runner || createCodexRunner(config);
  const store = options.store || createThreadStore(config.runtime.sessionThreadStorePath);
  const queue = new TaskQueue(config.runtime.maxConcurrentJobs);
  const chains = new Map();
  const seen = new Set();
  const cliManager = options.cliManager || createPlatformCliManager(config);
  let outstanding = 0;
  let accepting = 0;
  let status = { state: "stopped", startedAt: "", stoppedAt: "", lastError: "", lastMessageAt: "" };
  function onState(state, message = "") {
    if (status.state === state && (!message || status.lastError === message)) return;
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
    const { id, chatId, userId, chatType } = message;
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
    const replies = createPlatformReplies(message, {
      enabled: config.feishu.streamingCardEnabled,
      intervalMs: options.replyIntervalMs,
      heartbeatMs: options.replyHeartbeatMs ?? 20000,
      timeoutMs: options.replyTimeoutMs,
      onError: (error) => { void update({ deliveryWarning: "部分流式回复未送达" }).catch(onError); onError(error); }
    });
    void replies.acknowledge(outstanding > 1).catch(async (error) => {
      onError(error);
      await update({ deliveryWarning: "接收确认未送达" }).catch(onError);
    });
    const previous = chains.get(sessionKey) || Promise.resolve();
    const task = previous.catch(() => {}).then(() => queue.push(async () => {
      try {
        // Receipt delivery runs in parallel; a slow transport must not block Codex.
        replies.started();
        await update({ status: "running" });
        const record = await store.get(sessionKey);
        const skills = config.bot.preferredSkills || [];
        const skillContext = skills.length ? "Prefer these installed skills when relevant:\n" + skills.join("\n") + "\n\n" : "";
        const cliStatus = config.bot.platformCliEnabled ? await cliManager.getStatus(config.bot) : null;
        const result = await runner.run({ prompt: platformCliPrompt(config, cliStatus) + skillContext + applyCompressedContext(prompt, record),
          messageId: id, resumeSessionId: config.feishu.sessionThreadsEnabled ? record?.threadId : undefined,
          onEvent: (event) => replies.onEvent(event) });
        await update({ status: "completed", completedAt: new Date().toISOString(), responseText: result.message,
          responseSummary: (result.message || "").slice(0, 320), durationMs: result.durationMs, deliveryStatus: "pending" }, result.threadId);
        try { await replies.finish(result.message || "已完成"); await update({ deliveryStatus: "sent" }); }
        catch (error) { await update({ deliveryStatus: "failed", deliveryError: error.message }); onError(error); }
      } catch (error) {
        const detail = (error.details && getCodexFailureMessage(error.details)) || error.message;
        await update({ status: "failed", completedAt: new Date().toISOString(), errorText: detail });
        await replies.finish("执行未完成：" + detail.slice(0, 1500), true).catch(async (deliveryError) => {
          await update({ deliveryError: deliveryError.message }); onError(deliveryError);
        });
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
