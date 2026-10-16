import { spawn } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";

import { buildFeishuCliSpawn } from "./feishuCli.js";
import { readJsonFile, writeJsonFile } from "./fileStore.js";

const DEFAULT_AUTH_DOMAINS = [
  "approval",
  "apps",
  "attendance",
  "base",
  "calendar",
  "contact",
  "docs",
  "drive",
  "event",
  "im",
  "mail",
  "markdown",
  "minutes",
  "okr",
  "sheets",
  "slides",
  "task",
  "vc",
  "wiki"
];

function createCliEnv(config) {
  return {
    ...process.env,
    LARKSUITE_CLI_CONFIG_DIR: config.cli.configDir
  };
}

function extractJson(stdout) {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch {
      // Keep scanning for the last JSON line.
    }
  }

  return null;
}

function truncateLog(text, maxChars = 4000) {
  if (!text || text.length <= maxChars) {
    return text || "";
  }

  return text.slice(-maxChars);
}

export function createCliTaskManager(config) {
  const authStatePath = path.join(config.runtime.managerStateDir, "cli-auth-state.json");
  const pendingAuthPath = path.join(config.cli.configDir, "pending-auth.json");
  const cliConfigPath = path.join(config.cli.configDir, "config.json");
  let authPollChild = null;

  async function saveAuthState(nextState) {
    await writeJsonFile(authStatePath, nextState);
    return nextState;
  }

  async function readAuthState() {
    return readJsonFile(authStatePath, {
      status: "idle",
      verificationUrl: "",
      deviceCode: "",
      verificationQrDataUrl: "",
      startedAt: "",
      finishedAt: "",
      error: "",
      logTail: ""
    });
  }

  function spawnCli(rawArgs, options = {}) {
    const invocation = buildFeishuCliSpawn(rawArgs, {
      cliBin: config.cli.bin,
      fallbackIdentity: config.cli.identity
    });

    const child = spawn(invocation.command, invocation.args, {
      cwd: process.cwd(),
      env: createCliEnv(config),
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });

    if (options.stdinText) {
      child.stdin.write(options.stdinText);
      child.stdin.end();
    } else {
      child.stdin.end();
    }

    return child;
  }

  async function runCli(rawArgs, options = {}) {
    const child = spawnCli(rawArgs, options);
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    const exitCode = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => resolve(code ?? 1));
    });

    const json = extractJson(stdout);

    if (exitCode !== 0) {
      const error = new Error(stderr.trim() || stdout.trim() || "CLI command failed");
      error.exitCode = exitCode;
      error.stdout = stdout;
      error.stderr = stderr;
      throw error;
    }

    return {
      exitCode,
      stdout,
      stderr,
      json
    };
  }

  async function createVerificationQrDataUrl(verificationUrl) {
    if (!verificationUrl) {
      return "";
    }

    const qrcodePath = path.join(config.runtime.managerStateDir, "cli-auth-qrcode.png");
    const relativeOutputPath = path.relative(process.cwd(), qrcodePath);
    if (relativeOutputPath.startsWith("..") || path.isAbsolute(relativeOutputPath)) {
      return "";
    }

    try {
      await fsp.mkdir(config.runtime.managerStateDir, { recursive: true });
      await runCli(["auth", "qrcode", verificationUrl, "--output", relativeOutputPath, "--size", "256"]);
      const image = await fsp.readFile(qrcodePath);
      return `data:image/png;base64,${image.toString("base64")}`;
    } catch {
      return "";
    }
  }

  async function getStatus() {
    const authState = await readAuthState();
    const { deviceCode, ...publicAuthState } = authState;
    if (deviceCode && publicAuthState.logTail) publicAuthState.logTail = publicAuthState.logTail.replaceAll(deviceCode, "[redacted]");
    const pendingAuth = await readJsonFile(pendingAuthPath, null);
    const cliConfig = await readJsonFile(cliConfigPath, null);
    let authStatus = null;

    if (cliConfig?.apps?.[0]?.appId) {
      try {
        const result = await runCli(["auth", "status"]);
        authStatus = result.json;
      } catch (error) {
        authStatus = {
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }

    return {
      configDir: config.cli.configDir,
      configuredAppId: cliConfig?.apps?.[0]?.appId || "",
      configuredBrand: cliConfig?.apps?.[0]?.brand || "",
      authStatus,
      pendingAuth: pendingAuth ? { verificationUrl: pendingAuth.verificationUrl || pendingAuth.verification_uri_complete || "", expiresAt: pendingAuth.expiresAt || "" } : null,
      authTask: {
        ...publicAuthState,
        running: Boolean(authPollChild)
      }
    };
  }

  return {
    async configureForBot(bot) {
      if (!bot?.appId || !bot?.appSecret) {
        throw new Error("Bot configuration is incomplete");
      }

      const result = await runCli(
        ["config", "init", "--app-id", bot.appId, "--app-secret-stdin", "--brand", "feishu"],
        {
          stdinText: `${bot.appSecret}\n`
        }
      );

      return {
        appId: bot.appId,
        result: result.json || {}
      };
    },

    async startAuthorization(options = {}) {
      if (authPollChild) {
        return this.getStatus();
      }

      const args = ["auth", "login", "--json", "--no-wait"];
      if (options.scope) {
        args.push("--scope", options.scope);
      } else {
        const domains = Array.isArray(options.domains) && options.domains.length
          ? options.domains
          : DEFAULT_AUTH_DOMAINS;

        for (const domain of domains) {
          args.push("--domain", domain);
        }

        if (options.recommend !== false) {
          args.push("--recommend");
        }
      }

      const startedAt = new Date().toISOString();
      const kickoff = await runCli(args);
      const payload = kickoff.json || {};
      const verificationUrl = payload.verification_url || payload.verification_uri_complete || "";
      const deviceCode = payload.device_code || "";
      if (!verificationUrl || !deviceCode) {
        throw new Error("CLI authorization did not return verification_url and device_code");
      }
      const verificationQrDataUrl = await createVerificationQrDataUrl(verificationUrl);

      await saveAuthState({
        status: "waiting_for_authorization",
        verificationUrl,
        deviceCode,
        verificationQrDataUrl,
        startedAt,
        finishedAt: "",
        error: "",
        logTail: truncateLog(`${kickoff.stdout}\n${kickoff.stderr}`.trim())
      });

      const pollChild = spawnCli(["auth", "login", "--device-code", deviceCode]);
      authPollChild = pollChild;
      let logTail = "";

      const appendLog = (chunk) => {
        logTail = truncateLog(`${logTail}${chunk.toString("utf8")}`);
      };

      pollChild.stdout.on("data", appendLog);
      pollChild.stderr.on("data", appendLog);

      pollChild.on("close", async (code) => {
        const finishedAt = new Date().toISOString();
        authPollChild = null;
        const nextStatus = code === 0 ? "authorized" : "failed";

        await saveAuthState({
          status: nextStatus,
          verificationUrl,
          deviceCode,
          verificationQrDataUrl,
          startedAt,
          finishedAt,
          error: code === 0 ? "" : "CLI authorization polling failed",
          logTail
        });
      });

      pollChild.on("error", async (error) => {
        authPollChild = null;
        await saveAuthState({
          status: "failed",
          verificationUrl,
          deviceCode,
          verificationQrDataUrl,
          startedAt,
          finishedAt: new Date().toISOString(),
          error: error.message,
          logTail
        });
      });

      return this.getStatus();
    },

    async cancelAuthorization() {
      if (authPollChild) {
        authPollChild.kill();
        authPollChild = null;
      }

      const current = await readAuthState();
      await saveAuthState({
        ...current,
        status: "cancelled",
        finishedAt: new Date().toISOString()
      });

      return this.getStatus();
    },

    getStatus
  };
}
