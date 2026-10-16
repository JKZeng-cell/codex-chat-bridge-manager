import { getCodexFailureMessage } from "./codexErrors.js";
import { chunkText, cleanCodexCliNoise, formatDuration, summarizeText, truncateMiddle } from "./utils.js";

export const STREAMING_CARD_ELEMENT_ID = "codex_stream";

const STATUS_LABELS = {
  Received: "已接收",
  Running: "执行中",
  Completed: "已完成",
  Failed: "执行失败"
};

function optimizeCardMarkdown(text) {
  return cleanCodexCliNoise(text || "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function statusLabel(status) {
  if (String(status).startsWith("Queued")) return "排队中";
  return STATUS_LABELS[status] || "执行中";
}

function buildStatusLine(status, startedAt) {
  return `**${statusLabel(status)}** · ${formatDuration(Math.max(0, Date.now() - startedAt))}`;
}

function compactCard(content, summary) {
  return {
    schema: "2.0",
    config: { wide_screen_mode: true, update_multi: true, summary: { content: summary } },
    body: { elements: [{ tag: "markdown", content }] }
  };
}

function failureSummary(errorText, maxChars) {
  const cleaned = optimizeCardMarkdown(errorText);
  const reason = getCodexFailureMessage({ stdoutTail: cleaned }) || cleaned
    .split("\n")
    .filter((line) => !/^\s*(Task execution failed\.?|Elapsed:.*)\s*$/i.test(line))
    .join("\n");
  const unsupported = reason.match(/The ['"]([^'"]+)['"] model is not supported/i);
  if (unsupported) return summarizeText(`当前账号不支持模型「${unsupported[1]}」，请在连接设置中更换模型。`, maxChars);
  return summarizeText(reason, maxChars) || "执行未完成，请在管理界面的会话记录中查看详情。";
}

export function buildInitialStreamingCard() {
  const card = compactCard(
    buildStreamingCardContent({ statusText: "Received", startedAt: Date.now(), progressLines: ["正在准备任务"] }),
    "已接收，正在准备任务"
  );
  card.config.streaming_mode = true;
  card.body.elements[0].element_id = STREAMING_CARD_ELEMENT_ID;
  return card;
}

export function buildStreamingCardContent(state, options = {}) {
  const latest = (state.progressLines || []).filter(Boolean).at(-1);
  const focus = summarizeText(latest || "正在准备任务", 100);
  return truncateMiddle(
    [buildStatusLine(state.statusText, state.startedAt), focus].join("\n\n"),
    options.maxChars || 3200
  );
}

export function buildFinalCard(state) {
  return compactCard(buildStatusLine("Completed", state.startedAt), "已完成");
}

export function buildFailureCard(state, errorText, options = {}) {
  const reason = failureSummary(errorText, Math.min(options.previewChars || 180, 180));
  return compactCard(
    [buildStatusLine("Failed", state.startedAt), reason, "完整错误见管理界面的会话记录。"].join("\n\n"),
    `执行失败：${reason}`
  );
}

export function buildMarkdownReplyChunks(text, maxChars, label) {
  const safeLimit = Math.max(80, maxChars - 24);
  const cleaned = optimizeCardMarkdown(text) || "Done.";
  const chunks = chunkText(cleaned, safeLimit);

  if (chunks.length <= 1) {
    return chunks;
  }

  return chunks.map((chunk, index) => `Part ${index + 1}/${chunks.length}${label ? ` - ${label}` : ""}\n\n${chunk}`);
}
