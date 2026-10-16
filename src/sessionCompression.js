import { summarizeText, truncateMiddle } from "./utils.js";

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function formatEntry(entry) {
  const timestamp = entry.completedAt || entry.updatedAt || entry.createdAt || "";
  const label = timestamp ? `[${timestamp}]` : "[history]";
  const request = summarizeText(entry.userPrompt || entry.prompt || "", 200) || "(empty request)";
  const outcome =
    summarizeText(entry.responseSummary || entry.responseText || entry.errorText || entry.status || "", 240) ||
    "(no stored outcome)";

  return `${label} ${request}\nOutcome: ${outcome}`;
}

export function buildCompressedSummary(record, options = {}) {
  const maxHistoryItems = Math.max(1, options.maxHistoryItems || 8);
  const maxChars = Math.max(400, options.maxChars || 4000);
  const history = ensureArray(record?.history).slice(-maxHistoryItems);
  const header = [
    `Session key: ${record?.sessionKey || "(unknown)"}`,
    record?.chatType && record?.chatId ? `Chat: ${record.chatType}/${record.chatId}` : "",
    record?.openId ? `Requester open_id: ${record.openId}` : "",
    record?.compressionCount ? `Previous compressions: ${record.compressionCount}` : ""
  ].filter(Boolean);

  const body = history.length
    ? history.map(formatEntry)
    : ["No concrete request history was stored yet. Continue carefully from the next user message."];

  return truncateMiddle([...header, "", "Condensed session history:", ...body].join("\n"), maxChars);
}

export function compressSessionRecord(record, options = {}) {
  const now = options.now || new Date().toISOString();
  const next = {
    ...(record || {})
  };

  const archivedThreadIds = ensureArray(next.archivedThreadIds);
  if (next.threadId) {
    archivedThreadIds.push(next.threadId);
  }

  next.threadId = "";
  next.archivedThreadIds = Array.from(new Set(archivedThreadIds));
  next.compressedSummary = buildCompressedSummary(next, options);
  next.compressedAt = now;
  next.compressionCount = (next.compressionCount || 0) + 1;
  next.updatedAt = now;

  return next;
}

export function applyCompressedContext(prompt, record) {
  const summary = record?.compressedSummary?.trim();
  if (!summary) {
    return prompt;
  }

  return [
    "Use this condensed session context when it helps:",
    summary,
    "",
    "Current user request:",
    prompt
  ].join("\n");
}
