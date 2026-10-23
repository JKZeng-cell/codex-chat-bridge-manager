import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listSkillsSync } from "./skillRegistry.js";

export const PLATFORM_CLIS = {
  wecom: { name: "企业微信 CLI", command: "wecom-cli", package: "@wecom/cli", minimum: "1.2.1",
    variable: "WECOM_CLI_CONFIG_DIR", binVariable: "WECOM_CLI_BIN", versionArgs: ["--version"],
    statusArgs: ["auth", "show", "--status"], docs: "https://github.com/WecomTeam/wecom-cli" },
  dingtalk: { name: "钉钉 CLI", command: "dws", package: "dingtalk-workspace-cli", minimum: "1.0.65",
    variable: "DWS_CONFIG_DIR", binVariable: "DINGTALK_CLI_BIN", versionArgs: ["version"],
    statusArgs: ["auth", "status", "--readonly", "--format", "json"], docs: "https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli" }
};

export function platformCliDirectory(config, bot) {
  if (!Object.hasOwn(PLATFORM_CLIS, bot.platform) || !/^[a-zA-Z0-9_-]{1,100}$/.test(bot.id)) throw new Error("不支持的 CLI 连接");
  return path.join(config.runtime.botsStateDir, bot.id, "cli", bot.platform);
}

export function resolvePlatformCli(platform, options = {}) {
  const definition = PLATFORM_CLIS[platform];
  if (!definition) throw new Error("不支持的 CLI 平台");
  const env = options.env || process.env;
  const win = (options.platform || process.platform) === "win32";
  const exists = options.exists || ((file) => { try { return fs.statSync(file).isFile(); } catch { return false; } });
  const suffix = win ? ".exe" : "";
  const override = options.bin || env[definition.binVariable];
  const directories = (env.PATH || env.Path || "").split(win ? ";" : ":").filter(Boolean).map((dir) => dir.replace(/^"|"$/g, ""));
  if (override) {
    if (/\.(cmd|bat|ps1)$/i.test(override)) throw new Error("CLI 路径请使用官方原生可执行文件，不支持脚本启动器");
    const candidates = path.isAbsolute(override) ? [override] : directories.map((dir) => path.join(dir, override + (win && !path.extname(override) ? suffix : "")));
    return candidates.find(exists) || "";
  }
  if (options.bundledBin && exists(options.bundledBin)) return options.bundledBin;
  if (options.bundledOnly) return "";
  const home = options.home || os.homedir();
  const roots = [env.APPDATA && path.join(env.APPDATA, "npm", "node_modules"),
    ...directories.map((dir) => path.join(dir, "node_modules")),
    "/usr/local/lib/node_modules", "/usr/lib/node_modules"].filter(Boolean);
  const binaries = roots.map((root) => platform === "wecom"
    ? path.join(root, "@wecom", "cli", "node_modules", `@wecom/cli-${win ? "win32" : options.platform || process.platform}-${options.arch || process.arch}`, "bin", definition.command + suffix)
    : path.join(root, definition.package, "vendor", definition.command + suffix));
  if (platform === "wecom") binaries.push(...roots.map((root) => path.join(root, `@wecom/cli-${win ? "win32" : options.platform || process.platform}-${options.arch || process.arch}`, "bin", definition.command + suffix)));
  binaries.push(...directories.map((dir) => path.join(dir, definition.command + suffix)),
    path.join(home, ".local", "bin", definition.command + suffix), path.join(home, ".dws", "bin", definition.command + suffix));
  return binaries.find(exists) || "";
}

export function platformCliEnvironment(config, bot, env = process.env, binary = "") {
  const next = { ...env };
  // Never let ambient token overrides bypass this connection's isolated CLI profile.
  for (const key of Object.keys(next)) {
    if (/^(WECOM_CLI_(ACCESS_TOKEN|ADDITIONAL_HEADERS.*)|DWS_(CLIENT_ID|CLIENT_SECRET))$/i.test(key)) delete next[key];
  }
  const definition = PLATFORM_CLIS[bot.platform];
  next[definition.variable] = platformCliDirectory(config, bot);
  if (binary) {
    const key = Object.keys(next).find((name) => name.toLowerCase() === "path") || "PATH";
    next[key] = path.dirname(binary) + path.delimiter + (next[key] || "");
  }
  return next;
}

export function supportsPlatformCli(version, minimum) {
  const found = String(version).match(/\b(\d+)\.(\d+)\.(\d+)([^\s]*)/);
  if (!found || found[4].startsWith("-")) return false;
  const current = found.slice(1, 4).map(Number);
  const required = minimum.split(".").map(Number);
  for (let index = 0; index < 3; index++) {
    if (current[index] !== required[index]) return current[index] > required[index];
  }
  return true;
}

export function platformCliVersion(text) {
  return String(text).match(/\bv?(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?)/i)?.[1] || "";
}

export function platformCliPrompt(config, status) {
  if (!config.bot?.platformCliEnabled || !PLATFORM_CLIS[config.bot.platform]) return "";
  const definition = PLATFORM_CLIS[config.bot.platform];
  if (!status?.supported || !status?.authorized) return `${definition.name} is unavailable or not authorized for this bot. Do not invoke platform CLI commands or use another account. Ask the user to install/authorize it in connection settings when needed.\n\n`;
  const binary = resolvePlatformCli(config.bot.platform, config.platformClis?.[config.bot.platform]);
  if (!binary) return `${definition.name} is not installed. Do not claim platform operations succeeded.\n\n`;
  const prefix = config.bot.platform === "wecom" ? "wecomcli-" : "dingtalk-";
  const skills = listSkillsSync(config.skills?.bundledRoots || []).filter((skill) => skill.name.startsWith(prefix));
  const catalog = skills.length ? "Bundled official skills (read the matching SKILL.md and its references before use):\n" +
    skills.map((skill) => "- " + skill.name + ": " + JSON.stringify(skill.path)).join("\n") + "\n" : "";
  return `Platform CLI: ${definition.command}; native executable: ${JSON.stringify(binary)}.\n` +
    `The ${definition.variable} environment variable selects this bot's isolated authorization. Do not read or switch to other local accounts.\n` +
    `CLI binaries and official skills are managed by this application. Do not globally install/upgrade tools or run skill setup commands that overwrite user skill directories; use application updates instead.\n` +
    catalog + `Use ${prefix}* skills and the CLI's actual --help/schema. Prefer bundled skills over older global copies. Never invent commands.\n` +
    `Check authorization before platform tasks. Request user confirmation for writes; never auto-approve permissions or select a different organization. Do not expose tokens or secrets.\n\n`;
}
