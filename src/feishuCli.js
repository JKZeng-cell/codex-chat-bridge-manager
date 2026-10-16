import fs from "node:fs";
import path from "node:path";

const IDENTITY_AWARE_COMMANDS = new Set([
  "api",
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
  "whiteboard",
  "wiki"
]);

const PASSTHROUGH_COMMANDS = new Set(["auth", "config", "doctor", "help", "profile", "schema", "update"]);
const USER_ONLY_COMMANDS = new Set(["docs +search", "im +messages-search"]);
const HELP_FLAGS = new Set(["-h", "--help"]);
const VALUE_FLAGS = new Set([
  "--as",
  "--api-version",
  "--brand",
  "--data",
  "--domain",
  "--format",
  "--jq",
  "--output",
  "--page-delay",
  "--page-limit",
  "--page-size",
  "--params",
  "--profile",
  "--scope",
  "-o",
  "-q"
]);
const WINDOWS_GLOBAL_FEISHU_CLI_BIN = process.env.APPDATA
  ? path.join(process.env.APPDATA, "npm", "lark-cli.cmd")
  : "lark-cli";
const DEFAULT_FEISHU_CLI_BIN =
  process.platform === "win32" && fs.existsSync(WINDOWS_GLOBAL_FEISHU_CLI_BIN)
    ? WINDOWS_GLOBAL_FEISHU_CLI_BIN
    : "lark-cli";

function isInlineValueFlag(arg, flag) {
  return flag.startsWith("--") && arg.startsWith(`${flag}=`);
}

function isExactValueFlag(arg) {
  return VALUE_FLAGS.has(arg);
}

function shouldSkipNextArgAsFlagValue(arg) {
  return isExactValueFlag(arg);
}

function hasFlag(args, flags) {
  return args.some((arg) => flags.has(arg) || [...flags].some((flag) => isInlineValueFlag(arg, flag)));
}

function hasIdentityArg(args) {
  return hasFlag(args, new Set(["--as"]));
}

function findTopLevelCommand(args) {
  let skipNext = false;

  for (const arg of args) {
    if (skipNext) {
      skipNext = false;
      continue;
    }

    if (arg.startsWith("-")) {
      skipNext = shouldSkipNextArgAsFlagValue(arg);
      continue;
    }

    return arg;
  }

  return "";
}

function findSubcommand(args, topLevel) {
  let seenTopLevel = false;
  let skipNext = false;

  for (const arg of args) {
    if (skipNext) {
      skipNext = false;
      continue;
    }

    if (arg.startsWith("-")) {
      skipNext = shouldSkipNextArgAsFlagValue(arg);
      continue;
    }

    if (!seenTopLevel) {
      seenTopLevel = arg === topLevel;
      continue;
    }

    return arg;
  }

  return "";
}

function shouldAutoInjectIdentity(args, subcommand) {
  if (!subcommand) {
    return false;
  }

  return !hasFlag(args, HELP_FLAGS);
}

export function resolveFeishuCliIdentity(rawArgs, fallbackIdentity = "bot") {
  const args = [...rawArgs];
  const topLevel = findTopLevelCommand(args);
  const subcommand = findSubcommand(args, topLevel);

  if (!args.length || !fallbackIdentity || hasIdentityArg(args)) {
    return "";
  }

  if (!topLevel || PASSTHROUGH_COMMANDS.has(topLevel) || !IDENTITY_AWARE_COMMANDS.has(topLevel)) {
    return "";
  }

  if (!shouldAutoInjectIdentity(args, subcommand)) {
    return "";
  }

  const commandKey = `${topLevel} ${subcommand}`;

  if (USER_ONLY_COMMANDS.has(commandKey)) {
    return "user";
  }

  return fallbackIdentity;
}

export function buildFeishuCliArgs(rawArgs, fallbackIdentity = "bot") {
  const args = [...rawArgs];
  const identity = resolveFeishuCliIdentity(args, fallbackIdentity);

  if (!identity) {
    return args;
  }

  return [...args, "--as", identity];
}

export function resolveFeishuCliBin(cliBin = process.env.FEISHU_CLI_BIN?.trim() || "") {
  return cliBin || DEFAULT_FEISHU_CLI_BIN;
}

export function buildFeishuCliInvocation(rawArgs, options = {}) {
  const fallbackIdentity = options.fallbackIdentity ?? (process.env.FEISHU_CLI_IDENTITY?.trim() || "bot");
  return {
    command: resolveFeishuCliBin(options.cliBin),
    args: buildFeishuCliArgs(rawArgs, fallbackIdentity)
  };
}

export function buildFeishuCliSpawn(rawArgs, options = {}) {
  const invocation = buildFeishuCliInvocation(rawArgs, options);

  if (process.platform !== "win32" || /\.exe$/i.test(invocation.command)) {
    return invocation;
  }

  return {
    command: "cmd.exe",
    args: ["/d", "/s", "/c", invocation.command, ...invocation.args]
  };
}
