export function splitReply(text, maxBytes = 16000) {
  const chunks = [];
  let chunk = "";
  let size = 0;
  for (const char of String(text)) {
    const bytes = Buffer.byteLength(char);
    if (size + bytes > maxBytes && chunk) {
      chunks.push(chunk);
      chunk = "";
      size = 0;
    }
    chunk += char;
    size += bytes;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

export function createPlatformReplies(message, options = {}) {
  const replace = () => message.streamingMode === "replace";
  const enabled = options.enabled !== false;
  const interval = options.intervalMs ?? (replace() ? 1000 : 2500);
  const items = new Map();
  const sentItems = new Set();
  let sentText = "";
  let latest = "";
  let closed = false;
  let timer;
  let chain = Promise.resolve();

  function enqueue(operation) {
    const result = chain.then(operation);
    chain = result.catch(() => {});
    return result;
  }

  async function flush() {
    if (replace()) {
      const text = latest;
      if (!text || text === sentText) return;
      await message.reply(text, false);
      sentText = text;
    } else {
      // Append-only transports must never send mutable snapshots as new messages.
      for (const [id, item] of items) {
        if (!item.completed || sentItems.has(id) || !item.text) continue;
        await message.reply(item.text, false);
        sentItems.add(id);
        sentText += (sentText ? "\n\n" : "") + item.text;
      }
    }
  }

  return {
    acknowledge(queued) {
      return enqueue(() => message.reply(queued ? "收到，已加入队列，稍后处理。" : "收到，正在处理…", false));
    },
    onEvent(event) {
      if (closed || !enabled || !["item.started", "item.updated", "item.completed"].includes(event?.type)) return;
      const item = event.item;
      if (item?.type !== "agent_message" || typeof item.text !== "string") return;
      const id = item.id || "answer";
      items.set(id, { text: item.text, completed: event.type === "item.completed" });
      latest = [...items.values()].map((entry) => entry.text).filter(Boolean).join("\n\n");
      if (!timer) timer = setTimeout(() => {
        timer = null;
        if (!closed) void enqueue(flush).catch((error) => options.onError?.(error));
      }, interval);
    },
    async finish(text, failed = false) {
      closed = true;
      clearTimeout(timer);
      await enqueue(async () => {
        let content = text || "已完成";
        if (!replace() && !failed && sentText) {
          if (content === sentText) return;
          content = content.startsWith(sentText) ? content.slice(sentText.length).trimStart() : "最终回复：\n" + content;
          if (!content) return;
        }
        await message.reply(content, true, { failed });
      });
    }
  };
}
