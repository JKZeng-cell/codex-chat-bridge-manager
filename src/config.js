import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { resolveFeishuCliBin } from "./feishuCli.js";

function readRequired(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function readBoolean(name, fallback = false) {
  const value = process.env[name];
  if (value == null || value === "") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

function readNumber(name, fallback) {
  const value = process.env[name];
  if (value == null || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be a number`);
  }

  return parsed;
}

function readCsv(name) {
  const value = process.env[name];
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readJsonArray(name) {
  const value = process.env[name];
  if (!value) {
    return [];
  }

  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error(`Environment variable ${name} must be a JSON array of strings`);
  }

  return parsed;
}

function buildBasePaths() {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const workdir = path.resolve(process.env.CODEX_WORKDIR || process.cwd());
  const logDir = path.resolve(process.env.LOG_DIR || path.join(process.cwd(), "runs"));
  const stateDir = path.resolve(process.env.STATE_DIR || path.join(projectRoot, "state"));

  return {
    projectRoot,
    workdir,
    logDir,
    stateDir
  };
}

export function loadManagerConfig() {
  const { projectRoot, workdir, logDir, stateDir } = buildBasePaths();
  const cliMode = (process.env.CODEX_CLI_MODE || "local").trim().toLowerCase();
  const sessionThreadsEnabled = readBoolean("FEISHU_SESSION_THREADS_ENABLED", true);
  const replySkillEnabled = readBoolean("FEISHU_REPLY_SKILL_ENABLED", true);
  const cliBin =
    process.env.CODEX_CLI_BIN?.trim() ||
    (cliMode === "global"
      ? "codex"
      : cliMode === "npx"
        ? process.platform === "win32"
          ? "npx.cmd"
          : "npx"
        : process.execPath);

  return {
    projectRoot,
    manager: {
      host: process.env.MANAGER_HOST?.trim() || "127.0.0.1",
      port: readNumber("MANAGER_PORT", 3210)
    },
    cli: {
      bin: resolveFeishuCliBin(process.env.FEISHU_CLI_BIN?.trim() || ""),
      identity: process.env.FEISHU_CLI_IDENTITY?.trim() || "bot",
      configDir: path.resolve(
        process.env.LARKSUITE_CLI_CONFIG_DIR || path.join(stateDir, "lark-cli-workconfig")
      )
    },
    skills: {
      roots: [
        path.join(os.homedir(), ".codex", "skills"),
        path.join(os.homedir(), ".agents", "skills")
      ],
      replySkillDefault:
        process.env.FEISHU_REPLY_SKILL_PATH?.trim() ||
        path.join(os.homedir(), ".codex", "skills", "feishu-markdown-reply", "SKILL.md")
    },
    defaults: {
      feishu: {
        commandPrefix: process.env.FEISHU_COMMAND_PREFIX?.trim() || "/codex",
        allowedChatIds: readCsv("FEISHU_ALLOWED_CHAT_IDS"),
        allowedOpenIds: readCsv("FEISHU_ALLOWED_OPEN_IDS"),
        allowPlainTextInP2P: readBoolean("FEISHU_ALLOW_PLAIN_TEXT_IN_P2P", true),
        attachmentsEnabled: readBoolean("FEISHU_ATTACHMENTS_ENABLED", true),
        preferCli: readBoolean("FEISHU_PREFER_CLI", true),
        cliIdentity: process.env.FEISHU_CLI_IDENTITY?.trim() || "bot",
        maxReplyChars: readNumber("FEISHU_MAX_REPLY_CHARS", 2000),
        reactionAck: process.env.FEISHU_REACTION_ACK?.trim() || "OnIt",
        reactionSuccess: process.env.FEISHU_REACTION_SUCCESS?.trim() || "DONE",
        reactionFailure: process.env.FEISHU_REACTION_FAILURE?.trim() || "ERROR",
        streamingCardEnabled: readBoolean("FEISHU_STREAMING_CARD_ENABLED", true),
        grantRequesterManageAccess: readBoolean("FEISHU_GRANT_REQUESTER_MANAGE_ACCESS", true),
        cardStreamUpdateMs: readNumber("FEISHU_CARD_STREAM_UPDATE_MS", 300),
        cardPatchUpdateMs: readNumber("FEISHU_CARD_PATCH_UPDATE_MS", 1500),
        cardContentMaxChars: readNumber("FEISHU_CARD_CONTENT_MAX_CHARS", 3200),
        cardReplyPreviewChars: readNumber("FEISHU_CARD_REPLY_PREVIEW_CHARS", 1000),
        cardCommandMaxItems: readNumber("FEISHU_CARD_COMMAND_MAX_ITEMS", 6),
        progressUpdateMs: readNumber("FEISHU_PROGRESS_UPDATE_MS", 1500),
        progressMaxLines: readNumber("FEISHU_PROGRESS_MAX_LINES", 8),
        progressEditLimit: readNumber("FEISHU_PROGRESS_EDIT_LIMIT", 15),
        progressMessageMaxChars: readNumber("FEISHU_PROGRESS_MESSAGE_MAX_CHARS", 1800),
        progressSummaryMaxChars: readNumber("FEISHU_PROGRESS_SUMMARY_MAX_CHARS", 500),
        sessionThreadsEnabled,
        replySkillEnabled
      }
    },
    feishu: {
      appId: process.env.FEISHU_APP_ID?.trim() || "",
      appSecret: process.env.FEISHU_APP_SECRET?.trim() || "",
      allowedChatIds: new Set(readCsv("FEISHU_ALLOWED_CHAT_IDS")),
      allowedOpenIds: new Set(readCsv("FEISHU_ALLOWED_OPEN_IDS")),
      commandPrefix: process.env.FEISHU_COMMAND_PREFIX?.trim() || "/codex",
      allowPlainTextInP2P: readBoolean("FEISHU_ALLOW_PLAIN_TEXT_IN_P2P", true),
      attachmentsEnabled: readBoolean("FEISHU_ATTACHMENTS_ENABLED", true),
      preferCli: readBoolean("FEISHU_PREFER_CLI", true),
      cliBin: resolveFeishuCliBin(process.env.FEISHU_CLI_BIN?.trim() || ""),
      cliIdentity: process.env.FEISHU_CLI_IDENTITY?.trim() || "bot",
      maxReplyChars: readNumber("FEISHU_MAX_REPLY_CHARS", 2000),
      reactionAck: process.env.FEISHU_REACTION_ACK?.trim() || "OnIt",
      reactionSuccess: process.env.FEISHU_REACTION_SUCCESS?.trim() || "DONE",
      reactionFailure: process.env.FEISHU_REACTION_FAILURE?.trim() || "ERROR",
      streamingCardEnabled: readBoolean("FEISHU_STREAMING_CARD_ENABLED", true),
      grantRequesterManageAccess: readBoolean("FEISHU_GRANT_REQUESTER_MANAGE_ACCESS", true),
      cardStreamUpdateMs: readNumber("FEISHU_CARD_STREAM_UPDATE_MS", 300),
      cardPatchUpdateMs: readNumber("FEISHU_CARD_PATCH_UPDATE_MS", 1500),
      cardContentMaxChars: readNumber("FEISHU_CARD_CONTENT_MAX_CHARS", 3200),
      cardReplyPreviewChars: readNumber("FEISHU_CARD_REPLY_PREVIEW_CHARS", 1000),
      cardCommandMaxItems: readNumber("FEISHU_CARD_COMMAND_MAX_ITEMS", 6),
      progressUpdateMs: readNumber("FEISHU_PROGRESS_UPDATE_MS", 1500),
      progressMaxLines: readNumber("FEISHU_PROGRESS_MAX_LINES", 8),
      progressEditLimit: readNumber("FEISHU_PROGRESS_EDIT_LIMIT", 15),
      progressMessageMaxChars: readNumber("FEISHU_PROGRESS_MESSAGE_MAX_CHARS", 1800),
      progressSummaryMaxChars: readNumber("FEISHU_PROGRESS_SUMMARY_MAX_CHARS", 500),
      sessionThreadsEnabled,
      replySkillEnabled,
      replySkillPath:
        process.env.FEISHU_REPLY_SKILL_PATH?.trim() ||
        path.join(os.homedir(), ".codex", "skills", "feishu-markdown-reply", "SKILL.md")
    },
    codex: {
      cliMode,
      cliBin,
      cliPackage: process.env.CODEX_CLI_PACKAGE?.trim() || "@openai/codex@latest",
      localCliPath: path.join(projectRoot, "node_modules", "@openai", "codex", "bin", "codex.js"),
      model: process.env.CODEX_MODEL?.trim() || "",
      sandbox: process.env.CODEX_SANDBOX?.trim() || "workspace-write",
      workdir,
      addDirs: readCsv("CODEX_ADD_DIRS").map((item) => path.resolve(item)),
      skipGitRepoCheck: readBoolean("CODEX_SKIP_GIT_REPO_CHECK", true),
      ephemeral: sessionThreadsEnabled ? false : readBoolean("CODEX_EPHEMERAL", true),
      timeoutMs: readNumber("CODEX_TIMEOUT_MS", 600000),
      extraArgs: readJsonArray("CODEX_EXTRA_ARGS_JSON")
    },
    runtime: {
      stateDir,
      logDir,
      managerStateDir: path.join(stateDir, "manager"),
      botsStateDir: path.join(stateDir, "bots"),
      feishuAttachmentDir: path.resolve(
        process.env.FEISHU_ATTACHMENT_DIR || path.join(stateDir, "feishu-attachments")
      ),
      maxRecentFeishuAttachments: readNumber("FEISHU_MAX_RECENT_ATTACHMENTS", 5),
      recentFeishuAttachmentTtlMs: readNumber("FEISHU_RECENT_ATTACHMENT_TTL_MS", 3600000),
      maxConcurrentJobs: readNumber("MAX_CONCURRENT_JOBS", 1),
      sessionThreadStorePath: path.resolve(
        process.env.FEISHU_SESSION_THREAD_STORE_PATH || path.join(stateDir, "feishu-session-threads.json")
      )
    }
  };
}

function asSet(values) {
  return new Set(Array.isArray(values) ? values.filter(Boolean) : []);
}

function withDefault(value, fallback) {
  return value == null || value === "" ? fallback : value;
}

export function buildRuntimeConfigFromBot(bot, managerConfig = loadManagerConfig()) {
  if (!bot?.appId || !bot?.appSecret) {
    throw new Error("Bot configuration requires appId and appSecret");
  }

  const botStateDir = path.join(managerConfig.runtime.botsStateDir, bot.id);
  const botLogDir = path.join(managerConfig.runtime.logDir, bot.id);

  return {
    bot: {
      id: bot.id,
      platform: bot.platform || "feishu",
      platformConfig: bot.platformConfig || {},
      name: bot.name || bot.id,
      preferredSkills: Array.isArray(bot.preferredSkills) ? bot.preferredSkills : []
    },
    feishu: {
      appId: bot.appId,
      appSecret: bot.appSecret,
      allowedChatIds: asSet(withDefault(bot.allowedChatIds, managerConfig.defaults.feishu.allowedChatIds)),
      allowedOpenIds: asSet(withDefault(bot.allowedOpenIds, managerConfig.defaults.feishu.allowedOpenIds)),
      commandPrefix: withDefault(bot.commandPrefix, managerConfig.defaults.feishu.commandPrefix),
      allowPlainTextInP2P: withDefault(
        bot.allowPlainTextInP2P,
        managerConfig.defaults.feishu.allowPlainTextInP2P
      ),
      attachmentsEnabled: withDefault(
        bot.attachmentsEnabled,
        managerConfig.defaults.feishu.attachmentsEnabled
      ),
      preferCli: withDefault(bot.preferCli, managerConfig.defaults.feishu.preferCli),
      cliBin: managerConfig.cli.bin,
      cliIdentity: withDefault(bot.cliIdentity, managerConfig.cli.identity),
      maxReplyChars: managerConfig.feishu.maxReplyChars,
      reactionAck: managerConfig.feishu.reactionAck,
      reactionSuccess: managerConfig.feishu.reactionSuccess,
      reactionFailure: managerConfig.feishu.reactionFailure,
      streamingCardEnabled: withDefault(
        bot.streamingCardEnabled,
        managerConfig.defaults.feishu.streamingCardEnabled
      ),
      grantRequesterManageAccess: withDefault(
        bot.grantRequesterManageAccess,
        managerConfig.defaults.feishu.grantRequesterManageAccess
      ),
      cardStreamUpdateMs: managerConfig.feishu.cardStreamUpdateMs,
      cardPatchUpdateMs: managerConfig.feishu.cardPatchUpdateMs,
      cardContentMaxChars: managerConfig.feishu.cardContentMaxChars,
      cardReplyPreviewChars: managerConfig.feishu.cardReplyPreviewChars,
      cardCommandMaxItems: managerConfig.feishu.cardCommandMaxItems,
      progressUpdateMs: managerConfig.feishu.progressUpdateMs,
      progressMaxLines: managerConfig.feishu.progressMaxLines,
      progressEditLimit: managerConfig.feishu.progressEditLimit,
      progressMessageMaxChars: managerConfig.feishu.progressMessageMaxChars,
      progressSummaryMaxChars: managerConfig.feishu.progressSummaryMaxChars,
      sessionThreadsEnabled: withDefault(
        bot.sessionThreadsEnabled,
        managerConfig.defaults.feishu.sessionThreadsEnabled
      ),
      replySkillEnabled: withDefault(bot.replySkillEnabled, managerConfig.defaults.feishu.replySkillEnabled),
      replySkillPath: withDefault(bot.replySkillPath, managerConfig.skills.replySkillDefault)
    },
    skills: {
      ...managerConfig.skills
    },
    codex: {
      ...managerConfig.codex,
      workdir: path.resolve(withDefault(bot.workdir, managerConfig.codex.workdir)),
      model: withDefault(bot.model, managerConfig.codex.model)
    },
    runtime: {
      ...managerConfig.runtime,
      logDir: botLogDir,
      feishuAttachmentDir: path.join(botStateDir, "attachments"),
      sessionThreadStorePath: path.join(botStateDir, "sessions.json"),
      maxConcurrentJobs: Math.max(
        1,
        Number(withDefault(bot.maxConcurrentJobs, managerConfig.runtime.maxConcurrentJobs)) || 1
      )
    }
  };
}

export function loadConfig() {
  const managerConfig = loadManagerConfig();
  const appId = readRequired("FEISHU_APP_ID");
  const appSecret = readRequired("FEISHU_APP_SECRET");

  return buildRuntimeConfigFromBot(
    {
      id: "default",
      name: "Default Bot",
      appId,
      appSecret,
      commandPrefix: managerConfig.feishu.commandPrefix,
      allowedChatIds: [...managerConfig.feishu.allowedChatIds],
      allowedOpenIds: [...managerConfig.feishu.allowedOpenIds],
      allowPlainTextInP2P: managerConfig.feishu.allowPlainTextInP2P,
      attachmentsEnabled: managerConfig.feishu.attachmentsEnabled,
      preferCli: managerConfig.feishu.preferCli,
      cliIdentity: managerConfig.feishu.cliIdentity,
      streamingCardEnabled: managerConfig.feishu.streamingCardEnabled,
      grantRequesterManageAccess: managerConfig.feishu.grantRequesterManageAccess,
      sessionThreadsEnabled: managerConfig.feishu.sessionThreadsEnabled,
      replySkillEnabled: managerConfig.feishu.replySkillEnabled,
      replySkillPath: managerConfig.feishu.replySkillPath,
      workdir: managerConfig.codex.workdir,
      model: managerConfig.codex.model,
      maxConcurrentJobs: managerConfig.runtime.maxConcurrentJobs
    },
    managerConfig
  );
}
