import * as Lark from "@larksuiteoapi/node-sdk";
import path from "node:path";

import { createCodexRunner, CodexRunError } from "./codexRunner.js";
import { getCodexFailureMessage } from "./codexErrors.js";
import { loadConfig } from "./config.js";
import { buildCodexPrompt, buildFeishuHelpText } from "./feishuCapabilities.js";
import {
  buildAttachmentReceivedText,
  buildFeishuAttachmentPromptContext,
  createSessionAttachmentStore,
  downloadIncomingAttachment,
  extractIncomingAttachment,
  resolveReplyAttachments,
  sanitizeAttachmentStorageName,
  sendReplyAttachments
} from "./feishuAttachments.js";
import { buildSessionKey, createThreadStore } from "./threadStore.js";
import { createFeishuRunReporter } from "./feishuReporter.js";
import { getFeishuReplySkillContext } from "./feishuReplySkill.js";
import { buildInstalledLarkSkillContext } from "./skillRegistry.js";
import { TaskQueue } from "./taskQueue.js";
import { applyCompressedContext } from "./sessionCompression.js";
import {
  buildHelpText,
  cleanCodexCliNoise,
  extractCommand,
  formatDuration,
  parseMessageText,
  summarizeText,
  truncateMiddle
} from "./utils.js";

function buildPreferredSkillContext(preferredSkills) {
  if (!Array.isArray(preferredSkills) || preferredSkills.length === 0) {
    return "";
  }

  return [
    "Prefer these locally installed skills when they match the request:",
    ...preferredSkills.map((skill) => {
      const label = typeof skill === "string" ? path.basename(path.dirname(skill)) : String(skill);
      const location = typeof skill === "string" ? ` (${skill})` : "";
      return `- ${label}${location}`;
    })
  ].join("\n");
}

function buildRuntimeStatusText(config, serviceState, queue) {
  const snapshot = queue.snapshot();
  return [
    "Bridge status:",
    `Bot: ${config.bot?.name || config.bot?.id || "default"}`,
    `Service state: ${serviceState}`,
    `Workdir: ${config.codex.workdir}`,
    `Max concurrency: ${config.runtime.maxConcurrentJobs}`,
    `Running: ${snapshot.activeCount}`,
    `Queued: ${snapshot.pendingCount}`,
    `CLI mode: ${config.codex.cliMode}`,
    `Sandbox: ${config.codex.sandbox || "(default)"}`,
    `Feishu execution: ${config.feishu.preferCli ? "CLI-first" : "SDK-first"}`,
    `Feishu CLI: ${config.feishu.cliBin} (${config.feishu.cliIdentity})`,
    `Reply mode: ${config.feishu.streamingCardEnabled ? "streaming cards" : "interactive patch cards"}`,
    `Attachments: ${config.feishu.attachmentsEnabled ? "enabled" : "disabled"}`,
    `Session threads: ${config.feishu.sessionThreadsEnabled ? "enabled" : "disabled"}`,
    `Session store: ${config.runtime.sessionThreadStorePath}`,
    `Attachment store: ${config.runtime.feishuAttachmentDir}`
  ].join("\n");
}

function buildWhoAmIText(context, threadRecord) {
  return [
    "Current Feishu context:",
    `chat_id: ${context.chatId}`,
    `open_id: ${context.openId || "(empty)"}`,
    `chat_type: ${context.chatType}`,
    `session_key: ${buildSessionKey(context)}`,
    `codex_thread_id: ${threadRecord?.threadId || "(none)"}`,
    threadRecord?.compressedAt ? `compressed_at: ${threadRecord.compressedAt}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function isMissingSessionThreadError(error) {
  const details =
    error instanceof CodexRunError && error.details
      ? [error.details.stderrTail, error.details.stdoutTail].filter(Boolean).join("\n")
      : error instanceof Error
        ? error.message
        : String(error);

  const normalized = details.toLowerCase();
  return normalized.includes("thread/resume failed") || normalized.includes("no rollout found for thread id");
}

function ensureHistory(record) {
  return Array.isArray(record?.history) ? record.history : [];
}

function keepRecentHistory(history, maxItems = 120) {
  return history.slice(-maxItems);
}

function createSessionRecord(current, context, config, now) {
  return {
    ...(current || {}),
    botId: config.bot?.id || "default",
    botName: config.bot?.name || config.bot?.id || "default",
    sessionKey: buildSessionKey(context),
    chatId: context.chatId,
    chatType: context.chatType,
    openId: context.openId,
    createdAt: current?.createdAt || now,
    updatedAt: now,
    lastMessageId: context.messageId,
    history: ensureHistory(current)
  };
}

export function createBridgeRuntime(runtimeConfig, hooks = {}) {
  const config = runtimeConfig || loadConfig();
  const runner = createCodexRunner(config);
  const queue = new TaskQueue(config.runtime.maxConcurrentJobs);
  const sessionStore = createThreadStore(config.runtime.sessionThreadStorePath);
  const attachmentStore = createSessionAttachmentStore({
    maxItems: config.runtime.maxRecentFeishuAttachments,
    ttlMs: config.runtime.recentFeishuAttachmentTtlMs
  });
  const seenMessageIds = new Map();
  const sessionExecutionChains = new Map();
  const helpText = buildHelpText(config.feishu.commandPrefix);
  const larkHelpText = buildFeishuHelpText(config.feishu.commandPrefix);
  const preferredSkillContext = buildPreferredSkillContext(config.bot?.preferredSkills);

  const baseConfig = {
    appId: config.feishu.appId,
    appSecret: config.feishu.appSecret,
    appType: Lark.AppType.SelfBuild,
    domain: Lark.Domain.Feishu
  };

  let client = null;
  let wsClient = null;
  let state = "stopped";
  let startedAt = "";
  let stoppedAt = "";
  let lastError = "";
  let lastMessageAt = "";

  function emitLog(level, message, extra = {}) {
    hooks.onLog?.({
      timestamp: new Date().toISOString(),
      botId: config.bot?.id || "default",
      level,
      message,
      ...extra
    });
  }

  function setState(nextState, errorText = "") {
    state = nextState;
    if (errorText) {
      lastError = errorText;
    } else if (nextState !== "error") {
      lastError = "";
    }

    hooks.onStateChange?.({
      botId: config.bot?.id || "default",
      state,
      lastError
    });
  }

  function gcSeenMessages() {
    const threshold = Date.now() - 10 * 60 * 1000;
    for (const [messageId, seenAt] of seenMessageIds.entries()) {
      if (seenAt < threshold) {
        seenMessageIds.delete(messageId);
      }
    }
  }

  function isAuthorized({ chatId, openId }) {
    const { allowedChatIds, allowedOpenIds } = config.feishu;
    const chatAllowed = allowedChatIds.size === 0 || allowedChatIds.has(chatId);
    const userAllowed = allowedOpenIds.size === 0 || allowedOpenIds.has(openId);
    return chatAllowed && userAllowed;
  }

  async function sendText(chatId, text) {
    return client.im.v1.message.create({
      params: {
        receive_id_type: "chat_id"
      },
      data: {
        receive_id: chatId,
        msg_type: "text",
        content: JSON.stringify({ text })
      }
    });
  }

  async function replyText(messageId, text) {
    return client.im.v1.message.reply({
      path: {
        message_id: messageId
      },
      data: {
        msg_type: "text",
        content: JSON.stringify({ text })
      }
    });
  }

  async function createQueuedHistoryEntry(context, userPrompt, sessionAttachments) {
    const sessionKey = buildSessionKey(context);
    const entryId = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const now = new Date().toISOString();

    await sessionStore.update(sessionKey, (current) => {
      const record = createSessionRecord(current, context, config, now);
      const nextHistory = keepRecentHistory([
        ...record.history,
        {
          id: entryId,
          messageId: context.messageId,
          userPrompt,
          attachmentNames: sessionAttachments.map((item) => item.name),
          status: "queued",
          createdAt: now,
          updatedAt: now
        }
      ]);

      return {
        ...record,
        history: nextHistory
      };
    });

    hooks.onSessionUpdated?.(sessionKey);
    return entryId;
  }

  async function updateHistoryEntry(context, entryId, patch) {
    const sessionKey = buildSessionKey(context);
    const now = new Date().toISOString();

    await sessionStore.update(sessionKey, (current) => {
      const record = createSessionRecord(current, context, config, now);
      const nextHistory = record.history.map((entry) =>
        entry.id === entryId
          ? {
              ...entry,
              ...patch,
              updatedAt: now
            }
          : entry
      );

      return {
        ...record,
        history: keepRecentHistory(nextHistory),
        updatedAt: now
      };
    });

    hooks.onSessionUpdated?.(sessionKey);
  }

  async function persistSessionThread(context, threadId) {
    const sessionKey = buildSessionKey(context);
    const now = new Date().toISOString();

    await sessionStore.update(sessionKey, (current) => ({
      ...createSessionRecord(current, context, config, now),
      threadId: threadId || "",
      updatedAt: now
    }));

    hooks.onSessionUpdated?.(sessionKey);
  }

  async function runCodexForSession(context, prompt, reporter) {
    const sessionKey = buildSessionKey(context);
    const existingRecord = await sessionStore.get(sessionKey);
    const promptWithContext = applyCompressedContext(prompt, existingRecord);

    if (!config.feishu.sessionThreadsEnabled) {
      return runner.run({
        prompt: promptWithContext,
        messageId: context.messageId,
        onEvent: (event) => reporter.onCodexEvent(event),
        onStderr: (text) => reporter.onStderr(text)
      });
    }

    if (existingRecord?.threadId) {
      reporter.note("Reusing existing Codex session for this Feishu conversation.");
    } else if (existingRecord?.compressedSummary) {
      reporter.note("Starting a fresh Codex thread from a compressed session summary.");
    } else {
      reporter.note("Creating a new Codex session for this Feishu conversation.");
    }

    try {
      const result = await runner.run({
        prompt: promptWithContext,
        messageId: context.messageId,
        resumeSessionId: existingRecord?.threadId,
        onEvent: (event) => reporter.onCodexEvent(event),
        onStderr: (text) => reporter.onStderr(text)
      });

      await persistSessionThread(context, result.threadId);
      return result;
    } catch (error) {
      if (existingRecord?.threadId && isMissingSessionThreadError(error)) {
        reporter.note("The previous thread is no longer available. Starting a new one.");
        await persistSessionThread(context, "");

        const result = await runner.run({
          prompt: promptWithContext,
          messageId: context.messageId,
          onEvent: (event) => reporter.onCodexEvent(event),
          onStderr: (text) => reporter.onStderr(text)
        });

        await persistSessionThread(context, result.threadId);
        return result;
      }

      throw error;
    }
  }

  function runInSessionOrder(context, task) {
    const sessionKey = buildSessionKey(context);
    const previous = sessionExecutionChains.get(sessionKey) || Promise.resolve();
    const current = previous.catch(() => {}).then(task);

    sessionExecutionChains.set(sessionKey, current);

    return current.finally(() => {
      if (sessionExecutionChains.get(sessionKey) === current) {
        sessionExecutionChains.delete(sessionKey);
      }
    });
  }

  async function handleCodexJob(context, prompt, reporter, entryId) {
    const started = Date.now();

    try {
      reporter.start();
      await updateHistoryEntry(context, entryId, {
        status: "running",
        startedAt: new Date().toISOString()
      });

      const result = await runCodexForSession(context, prompt, reporter);
      const cleanedMessage = cleanCodexCliNoise(result.message) || result.message || "";
      await updateHistoryEntry(context, entryId, {
        status: "completed",
        completedAt: new Date().toISOString(),
        durationMs: result.durationMs,
        runId: result.runId,
        threadId: result.threadId,
        outputPath: result.outputPath,
        transcriptPath: result.transcriptPath,
        responseSummary: summarizeText(cleanedMessage, 320),
        responseText: truncateMiddle(cleanedMessage, 6000)
      });

      await reporter.completeSuccess(result);
    } catch (error) {
      const durationMs = Date.now() - started;
      const details =
        error instanceof CodexRunError && error.details
          ? getCodexFailureMessage(error.details) || truncateMiddle(
              [cleanCodexCliNoise(error.details.stderrTail), error.details.stdoutTail]
                .filter(Boolean)
                .join("\n"),
              2000
            )
          : error instanceof Error
            ? error.message
            : String(error);

      const failureText = [
        "Task execution failed.",
        `Elapsed: ${formatDuration(durationMs)}`,
        "",
        details || "No additional error details were captured."
      ].join("\n");

      await updateHistoryEntry(context, entryId, {
        status: "failed",
        completedAt: new Date().toISOString(),
        durationMs,
        errorText: details
      });

      await reporter.completeFailure(failureText);
      emitLog("error", "Codex job failed", { details });
    }
  }

  async function handleMessageEvent(data) {
    gcSeenMessages();
    attachmentStore.pruneAll();

    const messageId = data?.message?.message_id;
    if (!messageId || seenMessageIds.has(messageId)) {
      return;
    }
    seenMessageIds.set(messageId, Date.now());

    if (data?.sender?.sender_type && data.sender.sender_type !== "user") {
      return;
    }

    const chatId = data.message.chat_id;
    const chatType = data.message.chat_type;
    const messageType = data.message.message_type;
    const text = messageType === "text" ? parseMessageText(data.message.content) : "";
    const openId = data?.sender?.sender_id?.open_id || "";

    const context = {
      messageId,
      chatId,
      chatType,
      openId
    };

    lastMessageAt = new Date().toISOString();

    if (config.feishu.attachmentsEnabled && (messageType === "image" || messageType === "file" || messageType === "audio")) {
      if (!isAuthorized(context)) {
        await replyText(
          messageId,
          "This chat or user is not allowed to store attachments for local Codex tasks yet."
        );
        return;
      }

      const attachment = extractIncomingAttachment(data.message);
      if (!attachment) {
        return;
      }

      try {
        const sessionKey = buildSessionKey(context);
        const savedAttachment = await downloadIncomingAttachment({
          client,
          attachment,
          messageId,
          outputDir: path.join(
            config.runtime.feishuAttachmentDir,
            sanitizeAttachmentStorageName(sessionKey, "chat")
          )
        });
        attachmentStore.add(sessionKey, savedAttachment);
        await replyText(
          messageId,
          buildAttachmentReceivedText({
            chatType,
            attachment: savedAttachment,
            commandPrefix: config.feishu.commandPrefix
          })
        );
      } catch (error) {
        emitLog("warn", "Failed to download Feishu attachment", {
          details: error instanceof Error ? error.message : String(error)
        });
        await replyText(
          messageId,
          "The attachment could not be downloaded for Codex. Check bot resource scopes and try again."
        );
      }

      return;
    }

    const command = extractCommand({
      text,
      chatType,
      commandPrefix: config.feishu.commandPrefix,
      allowPlainTextInP2P: config.feishu.allowPlainTextInP2P
    });

    if (command.type === "ignore") {
      return;
    }

    if (command.type === "help") {
      await sendText(chatId, helpText);
      return;
    }

    if (command.type === "larkHelp") {
      await sendText(chatId, larkHelpText);
      return;
    }

    if (command.type === "whoami") {
      const threadRecord = await sessionStore.get(buildSessionKey(context));
      await sendText(chatId, buildWhoAmIText(context, threadRecord));
      return;
    }

    if (!isAuthorized(context)) {
      await sendText(
        chatId,
        "This chat or user is not allowed to run local Codex tasks yet. Add the chat_id or open_id to the allowlist first."
      );
      return;
    }

    if (command.type === "status") {
      await sendText(chatId, buildRuntimeStatusText(config, state, queue));
      return;
    }

    if (command.type === "sendAttachment") {
      if (!config.feishu.attachmentsEnabled) {
        await sendText(chatId, "Local attachment sending is disabled on this Feishu bridge.");
        return;
      }

      if (!command.path) {
        await sendText(chatId, `Usage: ${command.command || "/send-file"} <local path>`);
        return;
      }

      try {
        const attachments = resolveReplyAttachments(
          [
            {
              type: command.attachmentType,
              path: command.path
            }
          ],
          config
        );
        await sendReplyAttachments({
          messageId,
          attachments,
          config,
          client
        });
      } catch (error) {
        const details = error instanceof Error ? error.message : String(error);
        await sendText(chatId, `The local attachment could not be sent: ${details}`);
      }

      return;
    }

    if (command.type === "invalid") {
      if (command.reason === "missing-attachment-path") {
        await sendText(chatId, `Usage: ${command.command} <local path>`);
        return;
      }

      await sendText(chatId, `Usage: ${config.feishu.commandPrefix} <task description>`);
      return;
    }

    const snapshot = queue.snapshot();
    const ahead = snapshot.activeCount + snapshot.pendingCount;
    const reporter = createFeishuRunReporter({ client, config, context });
    const sessionAttachments = config.feishu.attachmentsEnabled
      ? attachmentStore.list(buildSessionKey(context))
      : [];
    const codexPrompt = buildCodexPrompt(command.prompt, {
      skillContext: preferredSkillContext,
      feishuSkillContext: buildInstalledLarkSkillContext(config.skills?.roots),
      replySkillContext: getFeishuReplySkillContext(config.feishu.replySkillPath, config.feishu.replySkillEnabled),
      attachmentContext: buildFeishuAttachmentPromptContext(sessionAttachments),
      requesterOpenId: context.openId,
      grantRequesterManageAccess: config.feishu.grantRequesterManageAccess
    });
    const entryId = await createQueuedHistoryEntry(context, command.prompt, sessionAttachments);

    await reporter.acknowledge(ahead);
    emitLog("info", "Queued Feishu request", {
      sessionKey: buildSessionKey(context),
      messageId
    });

    void queue.push(() => runInSessionOrder(context, () => handleCodexJob(context, codexPrompt, reporter, entryId)));
  }

  return {
    config,

    async start() {
      if (state === "running" || state === "starting") {
        return this.getStatus();
      }

      client = new Lark.Client(baseConfig);
      wsClient = new Lark.WSClient({
        ...baseConfig,
        loggerLevel: Lark.LoggerLevel.info
      });

      setState("starting");
      emitLog("info", "Starting Feishu bridge runtime");

      await wsClient.start({
        eventDispatcher: new Lark.EventDispatcher({}).register({
          "im.message.receive_v1": async (data) => {
            void handleMessageEvent(data).catch((error) => {
              emitLog("error", "Failed to handle Feishu message event", {
                details: error instanceof Error ? error.message : String(error)
              });
            });
            return;
          }
        })
      });

      startedAt = new Date().toISOString();
      stoppedAt = "";
      setState("running");
      emitLog("info", "Feishu bridge runtime is running", {
        workdir: config.codex.workdir
      });
      return this.getStatus();
    },

    async stop() {
      if (state === "stopped" || state === "stopping") {
        return this.getStatus();
      }

      setState("stopping");
      emitLog("info", "Stopping Feishu bridge runtime");

      try {
        wsClient?.close({ force: true });
      } catch (error) {
        emitLog("warn", "Failed to close Feishu websocket cleanly", {
          details: error instanceof Error ? error.message : String(error)
        });
      }

      wsClient = null;
      client = null;
      stoppedAt = new Date().toISOString();
      setState("stopped");
      emitLog("info", "Feishu bridge runtime stopped");
      return this.getStatus();
    },

    async restart() {
      await this.stop();
      return this.start();
    },

    getStatus() {
      return {
        botId: config.bot?.id || "default",
        botName: config.bot?.name || config.bot?.id || "default",
        state,
        startedAt,
        stoppedAt,
        lastError,
        lastMessageAt,
        workdir: config.codex.workdir,
        model: config.codex.model,
        logDir: config.runtime.logDir,
        sessionStorePath: config.runtime.sessionThreadStorePath,
        reconnectInfo: wsClient?.getReconnectInfo?.() || null,
        queue: queue.snapshot()
      };
    }
  };
}
