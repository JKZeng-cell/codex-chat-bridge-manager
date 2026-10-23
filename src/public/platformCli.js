import { icon } from "./icons.js";

export function setupPlatformCli({ $, state, selectedBot, api, post, escapeHtml: esc, patchContent, runAction, showToast, refreshAll, onEnabled }) {
  let botId = "";
  let value;
  let timer;
  let generation = 0;
  let requestId = 0;
  const section = $("platform-cli");
  const labels = { missing: "未安装", outdated: "需要升级", idle: "未授权", unknown: "待配置", authorized: "已授权", error: "检测异常",
    failed: "授权未完成", starting: "正在启动", waiting_for_authorization: "等待确认", cancelled: "已取消", expired: "已超时" };

  function draw() {
    const task = value?.authTask || {};
    const busy = task.running;
    $("platform-cli-authorize").disabled = !value?.supported || busy || state.overview?.maintenance?.state === "running";
    $("platform-cli-check").disabled = busy;
    $("platform-cli-cancel").hidden = !busy;
    $("platform-cli-enable").hidden = !value?.authorized || selectedBot()?.bot.platformCliEnabled;
    $("platform-cli-enable").disabled = busy || state.overview?.maintenance?.state === "running";
    const current = task.status || value?.state;
    patchContent($("platform-cli-status"), !value ? '<p class="muted">正在检测本机 CLI…</p>' :
      '<div class="platform-cli-summary"><strong>' + esc(labels[current] || "未检测") + '</strong><span class="muted">' + esc((value.bundled ? "内置 · " : "") + (value.version ? "v" + value.version : "本机工具")) + '</span></div>' +
      (value.skillCount ? '<p class="muted">已内置 ' + esc(value.skillCount) + ' 项官方技能，启用后按需加载，无需另行安装。</p>' : "") +
      '<p class="muted">' + esc(task.message || value.message || (value.authorized ? "当前连接的 CLI 授权可用。" : "授权独立保存，不使用其他机器人的账号。")) + '</p>' +
      (busy && task.verificationUrl ? '<a class="auth-link" href="' + esc(task.verificationUrl) + '" target="_blank" rel="noreferrer">打开授权页面 ' + icon("external") + '</a>' : "") +
      (busy && task.qrDataUrl?.startsWith("data:image/png;base64,") ? '<img class="auth-qr" src="' + esc(task.qrDataUrl) + '" alt="CLI 授权二维码" />' : "") +
      ((!value.installed || !value.supported) && !value.bundled ? '<div class="cli-install-hint"><p>源码模式可安装或升级后点击“检测”。桌面版已内置工具。集成版本要求 ≥ ' + esc(value.minimum) + '。</p><code>' + esc(value.installCommand) + '</code><button class="text-button" data-copy-cli>复制命令</button></div>' : "") +
      '<details data-persist-key="platform-cli-details"><summary>' + icon("chevron") + '授权说明</summary><p>与机器人收发消息的连接独立。仅在启用“平台 CLI”后向 Codex 提供调用指引；企业权限仍需管理员批准。</p><code class="cli-config-path">' + esc(value.configDir) + '</code><a href="' + esc(value.docs) + '" target="_blank" rel="noreferrer">官方说明 ' + icon("external") + '</a></details>');
  }
  async function refresh(action) {
    const id = botId;
    const sequence = generation;
    const request = ++requestId;
    clearTimeout(timer);
    try {
      const result = action ? await post("/api/platform-cli/" + id + "/" + action) : await api("/api/platform-cli/" + id);
      if (id !== botId || sequence !== generation || request !== requestId) return;
      value = result;
      draw();
      if (action === "enable") { await refreshAll(); if (id === botId) onEnabled?.(id); showToast(result.message, !result.applied); }
      if (result.authTask?.running) timer = setTimeout(() => { void refresh().catch(() => {}); }, 1800);
    } catch (error) {
      if (id !== botId || sequence !== generation || request !== requestId) return;
      patchContent($("platform-cli-status"), '<p role="alert">' + esc(error.message) + '</p>');
      $("platform-cli-check").disabled = false;
      timer = setTimeout(() => { if (botId === id && !section.hidden) void refresh().catch(() => {}); }, 5000);
      if (action) throw error;
    }
  }
  for (const [id, action] of [["platform-cli-check", "check"], ["platform-cli-authorize", "authorize"], ["platform-cli-cancel", "cancel"], ["platform-cli-enable", "enable"]]) {
    $(id).addEventListener("click", (event) => runAction(event.currentTarget, () => refresh(action)));
  }
  section.addEventListener("click", (event) => {
    const button = event.target.closest("[data-copy-cli]");
    if (button && value?.installCommand) void runAction(button, async () => {
      await navigator.clipboard.writeText(value.installCommand);
      showToast("安装命令已复制");
    });
  });
  return {
    render() {
      const bot = selectedBot()?.bot;
      section.hidden = state.creating || !["wecom", "dingtalk"].includes(bot?.platform);
      const next = section.hidden ? "" : bot.id;
      if (next !== botId) {
        botId = next; generation++; value = null; clearTimeout(timer);
        if (next) {
          $("platform-cli-title").textContent = bot.platform === "wecom" ? "企业微信 CLI" : "钉钉 CLI";
          draw(); void refresh().catch(() => {});
        }
      } else if (next && value) draw();
    }
  };
}
