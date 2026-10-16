export function parseMessageText(content) {
  if (!content) {
    return "";
  }

  try {
    const parsed = JSON.parse(content);
    return typeof parsed.text === "string" ? parsed.text : "";
  } catch {
    return "";
  }
}

export function stripBotMentions(text) {
  return text.replace(/@_user_\d+\s*/g, " ").replace(/\u200b/g, "").trim();
}

function stripWrappingQuotes(text) {
  if (!text) {
    return "";
  }

  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1).trim();
  }

  return text;
}

export function extractCommand({ text, chatType, commandPrefix, allowPlainTextInP2P }) {
  const normalized = stripBotMentions(text).trim();
  const lowered = normalized.toLowerCase();
  const loweredPrefix = commandPrefix.toLowerCase();

  if (!normalized) {
    return { type: "ignore" };
  }

  if (["/help", "help", "帮助"].includes(lowered)) {
    return { type: "help" };
  }

  if (["/lark-help", "/feishu-help", "lark help", "feishu help", "飞书帮助"].includes(lowered)) {
    return { type: "larkHelp" };
  }

  if (["/whoami", "whoami", "/ids", "ids"].includes(lowered)) {
    return { type: "whoami" };
  }

  if (["/status", "status"].includes(lowered)) {
    return { type: "status" };
  }

  for (const [helper, type, attachmentType] of [
    ["/send-file", "sendAttachment", "file"],
    ["/send-image", "sendAttachment", "image"],
    ["/send-audio", "sendAttachment", "audio"],
    ["/send-voice", "sendAttachment", "audio"],
    ["/send-local", "sendAttachment", ""]
  ]) {
    if (lowered === helper) {
      return { type: "invalid", reason: "missing-attachment-path", command: helper };
    }

    if (lowered.startsWith(`${helper} `)) {
      return {
        type,
        command: helper,
        attachmentType,
        path: stripWrappingQuotes(normalized.slice(helper.length).trim())
      };
    }
  }

  if (lowered === loweredPrefix) {
    return { type: "invalid", reason: "missing-prompt" };
  }

  if (lowered.startsWith(`${loweredPrefix} `)) {
    return { type: "codex", prompt: normalized.slice(commandPrefix.length).trim() };
  }

  if (allowPlainTextInP2P && chatType === "p2p") {
    return { type: "codex", prompt: normalized };
  }

  return { type: "ignore" };
}

export function chunkText(text, maxChars) {
  if (text.length <= maxChars) {
    return [text];
  }

  const chunks = [];
  let remaining = text;

  while (remaining.length > maxChars) {
    let splitAt = remaining.lastIndexOf("\n", maxChars);
    if (splitAt < Math.floor(maxChars / 2)) {
      splitAt = maxChars;
    }

    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks.filter(Boolean);
}

export function truncateMiddle(text, maxChars) {
  if (text.length <= maxChars) {
    return text;
  }

  const keep = Math.floor((maxChars - 5) / 2);
  return `${text.slice(0, keep)}\n...\n${text.slice(-keep)}`;
}

export function formatDuration(durationMs) {
  const seconds = Math.max(1, Math.round(durationMs / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (!remainingSeconds) {
    return `${minutes}m`;
  }

  return `${minutes}m ${remainingSeconds}s`;
}

const CODEX_CLI_NOISE_PATTERNS = [
  /failed to create shell snapshot/i,
  /startup remote plugin sync failed/i,
  /failed to warm featured plugin ids cache/i,
  /reading additional input from stdin/i,
  /ephemeral threads do not support includeturns/i,
  /enable javascript and cookies to continue/i,
  /window\._cf_chl_opt/i,
  /challenge-platform/i,
  /^<\/?(html|head|body|meta|style|script|div|svg|path)\b/i,
  /^at line:\d+/i,
  /^categoryinfo:/i,
  /^fullyqualifiederrorid/i
];

export function cleanCodexCliNoise(text) {
  if (!text) {
    return "";
  }

  return text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !CODEX_CLI_NOISE_PATTERNS.some((pattern) => pattern.test(line)))
    .join("\n")
    .trim();
}

export function summarizeText(text, maxChars = 180) {
  const cleaned = cleanCodexCliNoise(text).replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return "";
  }

  return truncateMiddle(cleaned, maxChars);
}

export function shortenShellCommand(command, maxChars = 180) {
  return summarizeText(command, maxChars);
}

export function describeCodexEvent(event) {
  if (!event || typeof event !== "object") {
    return "";
  }

  if (event.type === "thread.started") {
    return "已建立 Codex 会话";
  }

  if (event.type === "turn.started") {
    return "正在分析请求";
  }

  if (event.type === "turn.completed") {
    return "正在整理最终答复";
  }

  return "";
}

export function buildHelpText(prefix) {
  return [
    "Available commands:",
    `${prefix} <task description>`,
    "/send-file <local path>",
    "/send-image <local path>",
    "/send-audio <local path>",
    "/send-voice <local path>",
    "/send-local <local path>",
    "/lark-help",
    "/whoami",
    "/status",
    "/help",
    "",
    "Examples:",
    `${prefix} Check this workspace for obvious TypeScript errors`,
    `${prefix} Create a README in the working directory and explain how to start the project`,
    "/send-file runs/report.pdf",
    "/send-image runs/chart.png",
    "/send-audio runs/reply.opus"
  ].join("\n");
}
