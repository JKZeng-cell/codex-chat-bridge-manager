import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createBotStore } from "./botStore.js";
import { createBindingManager } from "./bindingManager.js";
import { createMaintenanceManager } from "./maintenanceManager.js";
import { createCliTaskManager } from "./cliTaskManager.js";
import { readModelCatalog } from "./modelCatalog.js";
import { createCodexStatusMonitor } from "./codexStatus.js";
import { buildRuntimeConfigFromBot } from "./config.js";
import { compressSessionRecord } from "./sessionCompression.js";
import { listSkills } from "./skillRegistry.js";
import { createServiceManager } from "./serviceManager.js";
import { createThreadStore } from "./threadStore.js";

const publicRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");

function json(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function text(res, statusCode, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store"
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    chunks.push(chunk);
    size += chunk.length;
    if (size > 1024 * 1024) {
      throw Object.assign(new Error("请求内容过大"), { statusCode: 413 });
    }
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) {
    return {};
  }

  return JSON.parse(raw);
}

function sanitizeBot(bot) {
  if (!bot) {
    return null;
  }

  return {
    ...bot,
    platformConfig: { baseUrl: bot.platformConfig?.baseUrl || "", ownerId: bot.platformConfig?.ownerId || "" },
    appSecret: bot.appSecret ? "********" : ""
  };
}

function createSeedBots(config) {
  if (!config.feishu.appId || !config.feishu.appSecret) {
    return [];
  }

  return [
    {
      id: "default-bot",
      name: "Default Bot",
      appId: config.feishu.appId,
      appSecret: config.feishu.appSecret,
      commandPrefix: config.feishu.commandPrefix,
      allowedChatIds: [...config.feishu.allowedChatIds],
      allowedOpenIds: [...config.feishu.allowedOpenIds],
      cliIdentity: config.feishu.cliIdentity,
      preferCli: config.feishu.preferCli,
      allowPlainTextInP2P: config.feishu.allowPlainTextInP2P,
      attachmentsEnabled: config.feishu.attachmentsEnabled,
      streamingCardEnabled: config.feishu.streamingCardEnabled,
      grantRequesterManageAccess: config.feishu.grantRequesterManageAccess,
      sessionThreadsEnabled: config.feishu.sessionThreadsEnabled,
      replySkillEnabled: config.feishu.replySkillEnabled,
      replySkillPath: config.feishu.replySkillPath,
      workdir: config.codex.workdir,
      model: config.codex.model,
      maxConcurrentJobs: config.runtime.maxConcurrentJobs,
      autoStart: true
    }
  ];
}

export function createManagerServer(config, options = {}) {
  const botStore = createBotStore(path.join(config.runtime.managerStateDir, "bots.json"), {
    seedBots: createSeedBots(config)
  });
  const cliTaskManager = createCliTaskManager(config);
  const serviceManager = createServiceManager(config, botStore);
  const bindingManager = createBindingManager(config, botStore, serviceManager);
  const maintenanceManager = createMaintenanceManager(config);
  const codexStatus = options.codexStatus || createCodexStatusMonitor(config);
  const startedAt = Date.now();

  async function getSessionStore(botId) {
    const bot = await botStore.get(botId);
    if (!bot) {
      throw new Error("Bot not found");
    }

    const runtimeConfig = buildRuntimeConfigFromBot(bot, config);
    return {
      bot,
      store: createThreadStore(runtimeConfig.runtime.sessionThreadStorePath),
      runtimeConfig
    };
  }

  async function buildOverview() {
    const statuses = await serviceManager.listStatuses();
    const cli = await cliTaskManager.getStatus();

    return {
      system: {
        state: "running",
        pid: process.pid,
        managerHost: config.manager.host,
        managerPort: config.manager.port,
        uptimeMs: Date.now() - startedAt,
        nodeVersion: process.version,
        platform: process.platform,
        cwd: process.cwd(),
        workdir: config.codex.workdir,
        stateDir: config.runtime.stateDir,
        logDir: config.runtime.logDir,
        cliConfigDir: config.cli.configDir
      },
      bots: statuses.map((entry) => ({
        bot: sanitizeBot(entry.bot),
        service: entry.service,
        logs: entry.logs
      })),
      models: await readModelCatalog(),
      codex: codexStatus.getStatus(),
      cli,
      maintenance: maintenanceManager.getStatus()
    };
  }

  async function handleApi(req, res, url) {
    if (req.method === "POST" && url.pathname === "/api/codex/status") {
      return json(res, 200, await codexStatus.refresh());
    }
    if (req.method === "POST" && url.pathname.startsWith("/api/cli/") && url.pathname !== "/api/cli/auth/cancel") {
      if (maintenanceManager.getStatus().state === "running") throw new Error("请等待工具更新完成后再授权");
      if (url.pathname === "/api/cli/configure" && (await cliTaskManager.getStatus()).authTask?.running) throw new Error("请先完成或取消正在进行的用户授权");
    }
    if (req.method === "POST" && url.pathname === "/api/bindings") {
      if (maintenanceManager.getStatus().state === "running") throw new Error("请等待更新完成后再绑定");
      return json(res, 202, bindingManager.start(await readBody(req)));
    }
    const bindingMatch = url.pathname.match(/^\/api\/bindings\/([a-f0-9-]+)(\/poll)?$/);
    if (bindingMatch) {
      if (req.method === "GET" || req.method === "POST") return json(res, 200, await bindingManager.get(bindingMatch[1], req.method === "POST"));
      if (req.method === "DELETE") return json(res, 200, bindingManager.cancel(bindingMatch[1]));
    }
    if (url.pathname === "/api/maintenance") {
      if (req.method === "GET") return json(res, 200, maintenanceManager.getStatus());
      if (req.method === "POST") {
        if (bindingManager.isActive()) throw new Error("请先完成或取消机器人绑定，再执行更新");
        const { action } = await readBody(req);
        if (action !== "check") {
          const entries = await serviceManager.listStatuses();
          if (entries.some(({ service }) => service.queue.activeCount || service.queue.pendingCount)) throw new Error("请等待机器人任务完成后更新工具");
          const cli = await cliTaskManager.getStatus();
          if (cli.authTask?.running) throw new Error("请先完成或取消飞书用户授权");
        }
        return json(res, 202, maintenanceManager.start(action));
      }
    }
    if (req.method === "GET" && url.pathname === "/api/overview") {
      return json(res, 200, await buildOverview());
    }

    if (req.method === "GET" && url.pathname === "/api/system/status") {
      return json(res, 200, {
        system: {
          state: "running",
          uptimeMs: Date.now() - startedAt,
          nodeVersion: process.version,
          platform: process.platform,
          pid: process.pid,
          cwd: process.cwd(),
          workdir: config.codex.workdir,
          stateDir: config.runtime.stateDir,
          logDir: config.runtime.logDir,
          managerHost: config.manager.host,
          managerPort: config.manager.port,
          cliConfigDir: config.cli.configDir
        },
        codex: codexStatus.getStatus(),
        services: (await serviceManager.listStatuses()).map((entry) => ({ ...entry, bot: sanitizeBot(entry.bot) }))
      });
    }

    if (req.method === "POST" && url.pathname === "/api/services") {
      const body = await readBody(req);
      const action = body.action || "startAll";

      if (action === "startAll") {
        await serviceManager.startAll();
      } else if (action === "stopAll") {
        await serviceManager.stopAll();
      } else if (action === "restartAll") {
        await serviceManager.restartAll();
      } else {
        throw new Error("Unsupported global service action");
      }

      return json(res, 200, {
        ok: true,
        action,
        services: (await serviceManager.listStatuses()).map((entry) => ({ ...entry, bot: sanitizeBot(entry.bot) }))
      });
    }

    if (req.method === "GET" && url.pathname === "/api/bots") {
      const bots = await botStore.list();
      return json(res, 200, {
        bots: bots.map(sanitizeBot)
      });
    }

    if (req.method === "POST" && url.pathname === "/api/bots") {
      const body = await readBody(req);
      const bot = await botStore.save(body);
      return json(res, 200, {
        bot: sanitizeBot(bot)
      });
    }

    const deleteBotMatch = url.pathname.match(/^\/api\/bots\/([^/]+)$/);
    if (req.method === "DELETE" && deleteBotMatch) {
      const botId = decodeURIComponent(deleteBotMatch[1]);
      const entry = (await serviceManager.listStatuses()).find((item) => item.bot.id === botId);
      if (entry?.service.queue.activeCount || entry?.service.queue.pendingCount) throw new Error("请等待机器人任务完成后移除连接");
      await serviceManager.stop(botId);
      await botStore.delete(botId);
      serviceManager.clear(botId);
      return json(res, 200, { ok: true });
    }

    const serviceMatch = url.pathname.match(/^\/api\/bots\/([^/]+)\/service$/);
    if (req.method === "POST" && serviceMatch) {
      const botId = decodeURIComponent(serviceMatch[1]);
      const body = await readBody(req);
      const action = body.action || "start";
      let service = null;

      if (action === "start") {
        service = await serviceManager.start(botId);
      } else if (action === "stop") {
        service = await serviceManager.stop(botId);
      } else if (action === "restart") {
        service = await serviceManager.restart(botId);
      } else {
        throw new Error("Unsupported service action");
      }

      return json(res, 200, { service });
    }

    const skillMatch = url.pathname.match(/^\/api\/bots\/([^/]+)\/skills$/);
    if (req.method === "POST" && skillMatch) {
      const botId = decodeURIComponent(skillMatch[1]);
      const body = await readBody(req);
      const bot = await botStore.update(botId, {
        preferredSkills: Array.isArray(body.preferredSkills) ? body.preferredSkills : [],
        replySkillEnabled: body.replySkillEnabled,
        replySkillPath: body.replySkillPath || ""
      });
      return json(res, 200, {
        bot: sanitizeBot(bot)
      });
    }

    if (req.method === "GET" && url.pathname === "/api/sessions") {
      const botId = url.searchParams.get("botId");
      if (!botId) {
        throw new Error("Missing botId");
      }

      const { store } = await getSessionStore(botId);
      const sessions = await store.list();
      return json(res, 200, {
        sessions
      });
    }

    if (req.method === "GET" && url.pathname === "/api/session") {
      const botId = url.searchParams.get("botId");
      const sessionKey = url.searchParams.get("sessionKey");
      if (!botId || !sessionKey) {
        throw new Error("Missing botId or sessionKey");
      }

      const { store } = await getSessionStore(botId);
      const session = await store.get(sessionKey);
      return json(res, 200, {
        session
      });
    }

    if (req.method === "POST" && url.pathname === "/api/session/compress") {
      const body = await readBody(req);
      const { botId, sessionKey } = body;
      if (!botId || !sessionKey) {
        throw new Error("Missing botId or sessionKey");
      }
      const entry = (await serviceManager.listStatuses()).find((item) => item.bot.id === botId);
      if (entry?.service.queue.activeCount || entry?.service.queue.pendingCount) throw new Error("请等待当前机器人的任务完成后压缩上下文");

      const { store } = await getSessionStore(botId);
      const session = await store.update(sessionKey, (current) => {
        if (!current) {
          throw new Error("Session not found");
        }

        return compressSessionRecord(current);
      });

      return json(res, 200, {
        session
      });
    }

    if (req.method === "GET" && url.pathname === "/api/skills") {
      const botId = url.searchParams.get("botId");
      const bot = botId ? await botStore.get(botId) : null;
      const skills = await listSkills(config.skills.roots, {
        selectedPaths: bot?.preferredSkills || [],
        replySkillPath: bot?.replySkillPath || config.skills.replySkillDefault
      });

      return json(res, 200, {
        skills,
        replySkillDefault: config.skills.replySkillDefault
      });
    }

    if (req.method === "GET" && url.pathname === "/api/cli/status") {
      return json(res, 200, await cliTaskManager.getStatus());
    }

    if (req.method === "POST" && url.pathname === "/api/cli/configure") {
      const body = await readBody(req);
      const bot = await botStore.get(body.botId);
      if (!bot) {
        throw new Error("Bot not found");
      }

      if ((bot.platform || "feishu") !== "feishu") throw new Error("仅飞书机器人支持飞书 CLI 授权");
      return json(res, 200, await cliTaskManager.configureForBot(bot));
    }

    if (req.method === "POST" && url.pathname === "/api/cli/auth/start") {
      const body = await readBody(req);
      return json(res, 200, await cliTaskManager.startAuthorization(body));
    }

    if (req.method === "POST" && url.pathname === "/api/cli/auth/cancel") {
      return json(res, 200, await cliTaskManager.cancelAuthorization());
    }

    return false;
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
      if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
        return json(res, 403, { error: "管理服务仅允许通过本机地址访问" });
      }

      if (url.pathname.startsWith("/api/")) {
        if (!["GET", "HEAD"].includes(req.method) && req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) {
          return json(res, 403, { error: "不允许跨站操作本地机器人" });
        }
        const handled = await handleApi(req, res, url);
        if (handled !== false) {
          return;
        }
      }

      const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
      const filePath = path.normalize(path.join(publicRoot, requestedPath));
      if (!filePath.startsWith(publicRoot + path.sep)) {
        return text(res, 403, "Forbidden");
      }

      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        return text(res, 404, "Not found");
      }

      const extension = path.extname(filePath);
      const contentType =
        extension === ".html"
          ? "text/html; charset=utf-8"
          : extension === ".css"
            ? "text/css; charset=utf-8"
            : extension === ".js"
              ? "application/javascript; charset=utf-8"
              : "text/plain; charset=utf-8";

      return text(res, 200, fs.readFileSync(filePath, "utf8"), contentType);
    } catch (error) {
      return json(res, error.statusCode || 500, {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  return {
    getAddress() { return server.address(); },
    async getShutdownStatus() {
      const entries = await serviceManager.listStatuses();
      return { busy: entries.some(({ service }) => service.queue.activeCount || service.queue.pendingCount) || maintenanceManager.getStatus().state === "running" };
    },
    async start() {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.manager.port, config.manager.host, resolve);
      });
      void serviceManager.startAutoStartBots().catch((error) => {
        console.error("Failed to auto-start bots", error);
      });
    },

    async stop() {
      bindingManager.close();
      maintenanceManager.close();
      await serviceManager.stopAll();
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error && error.code !== "ERR_SERVER_NOT_RUNNING") {
            reject(error);
            return;
          }
          resolve();
        });
        // Renderer polling or an unfinished HTTP body must not keep an idle app alive.
        server.closeAllConnections();
      });
    }
  };
}
