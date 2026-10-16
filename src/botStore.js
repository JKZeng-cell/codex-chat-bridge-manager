import crypto from "node:crypto";
import { assertPlatform, trustedWeixinBase } from "./platforms.js";

import { readJsonFile, updateJsonFile } from "./fileStore.js";

function toArray(value) {
  if (!value) {
    return [];
  }

  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : String(value)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

function normalizeBotRecord(input, current = null) {
  const now = new Date().toISOString();
  const id = current?.id || input.id || crypto.randomUUID();

  return {
    id,
    platform: assertPlatform(current?.platform || input.platform || "feishu"),
    platformConfig: { ...(current?.platformConfig || {}), ...(input.platformConfig || {}) },
    name: String(input.name || current?.name || "Feishu Bot").trim(),
    appId: String(input.appId || current?.appId || "").trim(),
    appSecret: String(input.appSecret || current?.appSecret || "").trim(),
    commandPrefix: String(input.commandPrefix || current?.commandPrefix || "/codex").trim(),
    allowedChatIds: toArray(input.allowedChatIds ?? current?.allowedChatIds),
    allowedOpenIds: toArray(input.allowedOpenIds ?? current?.allowedOpenIds),
    cliIdentity: String(input.cliIdentity || current?.cliIdentity || "bot").trim() || "bot",
    preferCli: input.preferCli ?? current?.preferCli ?? true,
    allowPlainTextInP2P: input.allowPlainTextInP2P ?? current?.allowPlainTextInP2P ?? true,
    attachmentsEnabled: input.attachmentsEnabled ?? current?.attachmentsEnabled ?? true,
    streamingCardEnabled: input.streamingCardEnabled ?? current?.streamingCardEnabled ?? true,
    grantRequesterManageAccess:
      input.grantRequesterManageAccess ?? current?.grantRequesterManageAccess ?? true,
    sessionThreadsEnabled: input.sessionThreadsEnabled ?? current?.sessionThreadsEnabled ?? true,
    replySkillEnabled: input.replySkillEnabled ?? current?.replySkillEnabled ?? true,
    replySkillPath: String(input.replySkillPath || current?.replySkillPath || "").trim(),
    preferredSkills: toArray(input.preferredSkills ?? current?.preferredSkills),
    workdir: String(input.workdir || current?.workdir || "").trim(),
    model: String(input.model ?? current?.model ?? "").trim(),
    maxConcurrentJobs: Number(input.maxConcurrentJobs ?? current?.maxConcurrentJobs ?? 1) || 1,
    autoStart: input.autoStart ?? current?.autoStart ?? true,
    createdAt: current?.createdAt || now,
    updatedAt: now
  };
}

function validateBotRecord(bot) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(bot.id)) throw new Error("机器人标识无效");
  if (bot.appSecret === "[object Object]") throw new Error("机器人密钥格式无效");
  if (!bot.name) {
    throw new Error("Bot name is required");
  }

  if (!bot.appId) {
    throw new Error("机器人 ID 不能为空");
  }

  if (!bot.appSecret) {
    throw new Error("机器人密钥不能为空");
  }

  if (bot.platform === "weixin") trustedWeixinBase(bot.platformConfig.baseUrl);
  return bot;
}

export function createBotStore(filePath, options = {}) {
  const seedBots = Array.isArray(options.seedBots) ? options.seedBots : [];

  async function ensureSeeded() {
    const existing = await readJsonFile(filePath, null);
    if (existing != null || seedBots.length === 0) {
      return;
    }

    await updateJsonFile(
      filePath,
      () => ({
        bots: seedBots.map((bot) => validateBotRecord(normalizeBotRecord(bot)))
      }),
      { bots: [] }
    );
  }

  return {
    async list() {
      await ensureSeeded();
      const data = await readJsonFile(filePath, { bots: [] });
      return Array.isArray(data?.bots)
        ? [...data.bots].sort((left, right) => left.name.localeCompare(right.name))
        : [];
    },

    async get(id) {
      const bots = await this.list();
      return bots.find((bot) => bot.id === id) || null;
    },

    async save(input) {
      await ensureSeeded();
      let savedBot = null;

      return updateJsonFile(
        filePath,
        (current) => {
          const bots = Array.isArray(current?.bots) ? [...current.bots] : [];
          const index = bots.findIndex((bot) => bot.id === input.id);
          const currentBot = index >= 0 ? bots[index] : null;
          const nextBot = validateBotRecord(normalizeBotRecord(input, currentBot));
          if (bots.some((bot) => bot.id !== nextBot.id && (bot.platform || "feishu") === nextBot.platform && bot.appId === nextBot.appId)) {
            throw new Error("此机器人已经绑定，请从连接卡片进入管理");
          }
          savedBot = nextBot;

          if (index >= 0) {
            bots[index] = nextBot;
          } else {
            bots.push(nextBot);
          }

          return {
            bots
          };
        },
        { bots: [] }
      ).then(() => savedBot);
    },

    async update(id, patch) {
      const current = await this.get(id);
      if (!current) {
        throw new Error("Bot not found");
      }

      return this.save({
        ...current,
        ...patch,
        id
      });
    },

    async delete(id) {
      await ensureSeeded();

      return updateJsonFile(
        filePath,
        (current) => ({
          bots: (Array.isArray(current?.bots) ? current.bots : []).filter((bot) => bot.id !== id)
        }),
        { bots: [] }
      );
    }
  };
}
