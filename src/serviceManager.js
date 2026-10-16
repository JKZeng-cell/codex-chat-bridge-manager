import { buildRuntimeConfigFromBot } from "./config.js";
import { createBridgeRuntime } from "./bridgeRuntime.js";
import { createPlatformRuntime } from "./platformRuntime.js";

function keepRecent(items, limit = 100) {
  return items.slice(-limit);
}

export function createServiceManager(config, botStore, options = {}) {
  const runtimes = new Map();
  const runtimeLogs = new Map();
  const runtimeVersions = new Map();
  const operations = new Map();
  const runtimeFactory = options.createRuntime || ((runtimeConfig, hooks) =>
    runtimeConfig.bot.platform === "feishu" ? createBridgeRuntime(runtimeConfig, hooks) : createPlatformRuntime(runtimeConfig, hooks));

  function versionOf(bot) {
    const { createdAt, updatedAt, ...settings } = bot;
    return JSON.stringify(settings);
  }

  function serialize(botId, action) {
    const previous = operations.get(botId) || Promise.resolve();
    const operation = previous.catch(() => {}).then(action);
    operations.set(botId, operation);
    return operation.finally(() => {
      if (operations.get(botId) === operation) operations.delete(botId);
    });
  }

  function assertIdle(runtime) {
    const queue = runtime?.getStatus().queue;
    if (queue?.activeCount || queue?.pendingCount) {
      throw new Error("机器人仍有执行中或排队的任务，请等待完成后再应用配置或重启。");
    }
  }

  function appendLog(botId, entry) {
    const next = keepRecent([...(runtimeLogs.get(botId) || []), entry], 120);
    runtimeLogs.set(botId, next);
  }

  function createRuntime(bot) {
    const runtimeConfig = buildRuntimeConfigFromBot(bot, config);
    const runtime = runtimeFactory(runtimeConfig, {
      onLog: (entry) => appendLog(bot.id, entry),
      onStateChange: (entry) => appendLog(bot.id, { ...entry, timestamp: new Date().toISOString() })
    });

    runtimes.set(bot.id, runtime);
    runtimeVersions.set(bot.id, versionOf(bot));
    return runtime;
  }

  async function getRuntime(botId) {
    const bot = await botStore.get(botId);
    if (!bot) {
      throw new Error("Bot not found");
    }
    const current = runtimes.get(botId);
    if (current && runtimeVersions.get(botId) === versionOf(bot)) {
      return current;
    }
    if (current) {
      assertIdle(current);
      await current.stop();
    }

    return createRuntime(bot);
  }

  return {
    async listStatuses() {
      const bots = await botStore.list();
      return Promise.all(
        bots.map(async (bot) => {
          const runtime = runtimes.get(bot.id);
          return {
            bot,
            service: runtime
              ? {
                  ...runtime.getStatus(),
                  configurationChanged: runtimeVersions.get(bot.id) !== versionOf(bot)
                }
              : {
                  botId: bot.id,
                  botName: bot.name,
                  state: "stopped",
                  queue: { activeCount: 0, pendingCount: 0 },
                  startedAt: "",
                  stoppedAt: "",
                  lastError: "",
                  lastMessageAt: "",
                  workdir: bot.workdir || config.codex.workdir,
                  model: bot.model || config.codex.model,
                  configurationChanged: false,
                  logDir: "",
                  sessionStorePath: "",
                  reconnectInfo: null
                },
            logs: runtimeLogs.get(bot.id) || []
          };
        })
      );
    },

    async start(botId) {
      return serialize(botId, async () => {
        const runtime = await getRuntime(botId);
        return runtime.start();
      });
    },

    async stop(botId) {
      return serialize(botId, async () => {
        const runtime = runtimes.get(botId);
        return runtime ? runtime.stop() : { botId, state: "stopped" };
      });
    },

    async restart(botId) {
      return serialize(botId, async () => {
        const bot = await botStore.get(botId);
        if (!bot) throw new Error("Bot not found");
        const current = runtimes.get(botId);
        assertIdle(current);
        if (current) await current.stop();
        // A websocket restart alone retains the old runner and credentials.
        const runtime = createRuntime(bot);
        return runtime.start();
      });
    },

    async startAutoStartBots() {
      const bots = await botStore.list();
      await Promise.all(bots.filter((item) => item.autoStart).map(async (bot) => {
        try { await this.start(bot.id); }
        catch (error) { appendLog(bot.id, { timestamp: new Date().toISOString(), level: "error", message: error.message }); }
      }));
    },

    async startAll() {
      const bots = await botStore.list();
      for (const bot of bots) {
        await this.start(bot.id);
      }
    },

    async stopAll() {
      const ids = [...runtimes.keys()];
      for (const botId of ids) {
        await this.stop(botId);
      }
    },

    async restartAll() {
      const bots = await botStore.list();
      for (const bot of bots) {
        await this.restart(bot.id);
      }
    },

    getLogs(botId) {
      return runtimeLogs.get(botId) || [];
    },

    clear(botId) {
      runtimeLogs.delete(botId);
      runtimes.delete(botId);
      runtimeVersions.delete(botId);
    }
  };
}
