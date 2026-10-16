import fs from "node:fs";

const DEFAULT_REPLY_RULES = [
  "Format the final answer using the local `feishu-markdown-reply` skill.",
  "- Return only the final message body. Do not add setup text or explain formatting choices.",
  "- Surface the main point early.",
  "- Use the lightest structure that fits: a short paragraph for simple replies, short headings with flat bullets for updates, and numbered lists only when order matters.",
  "- Use conservative Markdown only: **bold**, flat bullets, numbered lists, links, and short code spans.",
  "- Do not use tables, nested bullets, raw HTML, or decorative formatting.",
  "- Do not wrap the whole reply in a code fence unless the user explicitly asks for fenced Markdown.",
  "- Keep the tone concise, professional, and warm.",
  "- Prefer Simplified Chinese when the user writes in Chinese."
].join("\n");

let cachedSkillPath = "";
let cachedReplyContext = "";

function buildReplyContext(skillPath) {
  let skillText = "";

  try {
    skillText = fs.readFileSync(skillPath, "utf8");
  } catch {
    return DEFAULT_REPLY_RULES;
  }

  if (!skillText.includes("Feishu Markdown Reply")) {
    return DEFAULT_REPLY_RULES;
  }

  return [
    `Use the local skill at \`${skillPath}\` as the final presentation pass for the answer.`,
    DEFAULT_REPLY_RULES
  ].join("\n");
}

export function getFeishuReplySkillContext(skillPath, enabled = true) {
  if (!enabled) {
    return "";
  }

  if (cachedSkillPath !== skillPath || !cachedReplyContext) {
    cachedSkillPath = skillPath;
    cachedReplyContext = buildReplyContext(skillPath);
  }

  return cachedReplyContext;
}
