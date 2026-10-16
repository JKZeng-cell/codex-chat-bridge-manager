import { icon, mountIcons } from "./icons.js";
import { renderAvatar } from "./avatars.js";

const platforms = {
  feishu: ["飞书", "创建独立应用，扫码授权", "F"],
  wecom: ["企业微信", "扫码授权智能机器人", "企"],
  weixin: ["微信", "扫码绑定微信机器人", "微"],
  dingtalk: ["钉钉", "扫码创建并授权机器人", "D"]
};

export function setupConnections({ $, state, api, post, escapeHtml: esc, status, selectedBot, selectBot, setView, refreshAll, showToast, runAction, patchContent, avatarPreferences }) {
  let detail = false;
  let binding = null;
  let generation = 0;
  let pollTimer;
  let maintenanceTimer;
  let maintenanceState;
  let requestedAction;
  const dialog = $("bind-dialog");
  const active = (task) => ["starting", "waiting", "scanned", "binding"].includes(task?.state);
  const platformBadge = (platform) => '<span class="platform-logo platform-' + platform + '" aria-hidden="true">' + icon("platform-" + platform) + '</span>';

  function showGallery() {
    detail = false;
    if (state.creating) {
      state.creating = false;
      void selectBot(state.overview?.bots[0]?.bot.id || "").catch((error) => showToast(error.message, true));
    }
    render();
  }
  function showDetail() { detail = true; render(); }
  function render() {
    $("connection-gallery").hidden = detail;
    $("connection-detail").hidden = !detail;
    const entry = selectedBot();
    const platform = entry?.bot.platform || "feishu";
    $("feishu-authorization").hidden = platform !== "feishu";
    $("connection-help").textContent = (platform === "feishu" ? "扫码绑定后，在飞书中给机器人发送消息即可开始。已有应用也支持手动接入。" : "扫码授权后即可收发文本消息；群聊请使用配置的命令前缀。") + " 机器人可调用本机 Codex，请仅与可信联系人分享，并按需在高级设置限制用户与会话。";
    $("editor-description").textContent = (platforms[platform]?.[0] || "机器人") + "连接 · 配置只保存在本机";
    $("app-id-label").textContent = platform === "wecom" ? "Bot ID" : platform === "dingtalk" ? "Client ID" : platform === "weixin" ? "机器人 ID" : "App ID";
    $("app-secret-label").textContent = platform === "weixin" ? "机器人 Token" : platform === "dingtalk" ? "Client Secret" : "App Secret";
    $("bot-form").elements.namedItem("allowedOpenIds").closest("label").querySelector("span").textContent = platform === "feishu" ? "允许的 open_id" : "允许的用户 ID";
    $("delete-connection").hidden = !entry || state.creating;
    const feishuOnly = ["preferCli", "attachmentsEnabled", "streamingCardEnabled", "grantRequesterManageAccess", "cliIdentity"];
    for (const name of feishuOnly) $("bot-form").elements.namedItem(name).closest("label").hidden = platform !== "feishu";
    const bots = state.overview?.bots || [];
    $("connections-count").textContent = bots.length + " 个连接 · " + bots.filter((item) => item.service.state === "running").length + " 个在线";
    patchContent($("connection-cards"), bots.map((item) => {
      const p = item.bot.platform || "feishu";
      const avatarId = avatarPreferences.get(item.bot.id);
      const avatar = avatarId === "robot" ? platformBadge(p) : '<span class="connection-avatar">' + renderAvatar(avatarId) + platformBadge(p) + '</span>';
      return '<button class="connection-card" data-card-bot="' + esc(item.bot.id) + '"><div class="connection-card-top">' + avatar + status(item.service.state) + '</div><h2>' + esc(item.bot.name) + '</h2><p>' + esc(platforms[p]?.[0] || p) + ' · ' + esc(item.bot.appId) + '</p><div class="connection-card-note">' + esc(item.service.lastError || (item.service.configurationChanged ? "有新配置待应用" : item.service.state === "running" ? "消息服务正常，随时开始对话" : "连接后，即可开始对话")) + '</div><footer><span>' + esc(item.service.model || "默认模型") + '</span><span>管理 ' + icon("chevron") + '</span></footer></button>';
    }).join("") + '<button class="connection-card add-connection-card" id="add-connection-card"><span class="add-symbol">' + icon("plus") + '</span><h2>添加连接</h2><p>飞书 / 企业微信 / 微信 / 钉钉</p></button>');
  }

  async function stopBinding() {
    generation += 1; clearTimeout(pollTimer);
    const current = binding; binding = null;
    if (current?.id && active(current)) await api("/api/bindings/" + current.id, { method: "DELETE" });
  }

  async function openAdd() {
    try { await stopBinding(); } catch (error) { showToast(error.message, true); return; }
    $("binding-platforms").hidden = false;
    $("binding-progress").hidden = true;
    $("binding-name").value = "";
    $("bind-title").textContent = "添加连接";
    if (!dialog.open) dialog.showModal();
  }

  function renderBinding(task) {
    $("binding-platforms").hidden = true;
    $("binding-progress").hidden = false;
    $("bind-title").textContent = "绑定" + platforms[task.platform][0];
    $("binding-message").textContent = task.message;
    $("binding-message").classList.toggle("binding-error", ["error", "expired"].includes(task.state));
    $("binding-qr").hidden = !task.qrDataUrl || !active(task);
    if (task.qrDataUrl?.startsWith("data:image/png;base64,")) $("binding-qr").src = task.qrDataUrl;
    $("binding-placeholder").hidden = Boolean(task.qrDataUrl) || !active(task);
    $("binding-placeholder").innerHTML = icon("loader");
    $("binding-result").hidden = task.state !== "connected";
    $("retry-binding").hidden = !["expired", "error"].includes(task.state);
    $("binding-link").hidden = !active(task) || !/^https:\/\//.test(task.verificationUrl || "");
    if (!$("binding-link").hidden) $("binding-link").href = task.verificationUrl;
    $("binding-expiry").textContent = active(task) ? "二维码有效期至 " + new Date(task.expiresAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "";
  }

  async function begin(platform) {
    await stopBinding();
    const token = generation;
    binding = await post("/api/bindings", { platform, name: $("binding-name").value.trim() });
    if (token !== generation) { await api("/api/bindings/" + binding.id, { method: "DELETE" }); binding = null; return; }
    renderBinding(binding);
    let failures = 0;
    async function poll() {
      const current = binding;
      if (token !== generation || !dialog.open || !current) return;
      try {
        const result = await api("/api/bindings/" + current.id + (current.state === "starting" ? "" : "/poll"), { method: current.state === "starting" ? "GET" : "POST" });
        if (token !== generation) return;
        failures = 0; binding = result; renderBinding(result);
        if (result.state === "connected") { await refreshAll(); return; }
        if (!active(result)) return;
      } catch (error) {
        if (token !== generation) return;
        failures += 1;
        $("binding-message").textContent = failures < 3 ? "网络暂时不可用，正在重试…" : error.message;
        if (failures >= 3) { renderBinding({ ...binding, state: "error", message: error.message }); return; }
      }
      if (token === generation) pollTimer = setTimeout(poll, 1800);
    }
    pollTimer = setTimeout(poll, 500);
  }

  patchContent($("platform-options"), Object.entries(platforms).map(([key, [name, hint]]) => '<button class="platform-option" data-bind-platform="' + key + '">' + platformBadge(key) + '<span><strong>' + name + '</strong><small>' + hint + '</small></span>' + icon("chevron") + '</button>').join(""));
  $("platform-options").addEventListener("click", (event) => {
    const button = event.target.closest("[data-bind-platform]");
    if (button) runAction(button, () => begin(button.dataset.bindPlatform));
  });
  $("connection-cards").addEventListener("click", (event) => {
    const card = event.target.closest("[data-card-bot]");
    if (card && !state.busy) runAction(null, async () => { await selectBot(card.dataset.cardBot); showDetail(); });
    if (event.target.closest("#add-connection-card")) openAdd();
  });
  $("add-connection").addEventListener("click", () => openAdd());
  $("back-connections").addEventListener("click", showGallery);
  $("close-bind").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { void stopBinding().catch((error) => showToast(error.message, true)); });
  $("retry-binding").addEventListener("click", (event) => runAction(event.currentTarget, () => begin(binding.platform)));
  $("binding-result").addEventListener("click", (event) => runAction(event.currentTarget, async () => {
    const botId = binding.botId; dialog.close(); await selectBot(botId); setView("connections"); showDetail();
  }));
  $("manual-connection").addEventListener("click", () => {
    dialog.close(); state.creating = true; state.selectedBotId = ""; state.formKey = null;
    setView("connections"); refreshAll().then(showDetail).catch((error) => showToast(error.message, true));
  });
  $("delete-connection").addEventListener("click", () => {
    if (!selectedBot() || state.busy) return;
    $("delete-connection-name").textContent = selectedBot().bot.name;
    $("delete-dialog").showModal();
  });
  $("cancel-delete").addEventListener("click", () => $("delete-dialog").close());
  $("confirm-delete").addEventListener("click", (event) => runAction(event.currentTarget, async () => {
    const id = state.selectedBotId;
    await api("/api/bots/" + encodeURIComponent(id), { method: "DELETE" });
    state.drafts.delete(id); state.skillDrafts.delete(id); state.formKey = null;
    $("delete-dialog").close(); await refreshAll(); showGallery(); showToast("连接已移除，历史文件保留在本机");
  }));

  function renderMaintenance(task) {
    maintenanceState = task;
    if (state.overview) state.overview.maintenance = task;
    const result = task.result || {};
    const current = result.current_version || result.previous_version;
    const latest = result.latest_version || result.current_version;
    $("maintenance-message").textContent = task.message || "检查 CLI 版本与飞书技能同步状态";
    $("maintenance-message").classList.toggle("binding-error", task.state === "error");
    $("maintenance-versions").textContent = current ? "当前 " + current + (latest ? " · 最新 " + latest : "") : "尚未检查版本";
    $("maintenance-skills-status").textContent = result.skills_status ? (result.skills_status.in_sync ? "已与 CLI 同步" : "有待同步的官方技能") : "与飞书 CLI 配套的能力扩展";
    for (const button of document.querySelectorAll("[data-maintenance]")) { button.disabled = task.state === "running"; button.setAttribute("aria-busy", String(task.state === "running")); }
  }
  async function pollMaintenance() {
    clearTimeout(maintenanceTimer);
    try {
      const previous = maintenanceState?.state;
      const task = await api("/api/maintenance"); renderMaintenance(task);
      if (task.state === "running") maintenanceTimer = setTimeout(pollMaintenance, 2000);
      else if (previous === "running") {
        if (task.state === "completed" && task.action !== "check") { state.skillsBotId = ""; await refreshAll(); }
        showToast(task.message, task.state === "error");
      }
    } catch { maintenanceTimer = setTimeout(pollMaintenance, 5000); }
  }
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-maintenance]");
    if (!button) return;
    if (button.dataset.maintenance !== "check") {
      requestedAction = button.dataset.maintenance;
      $("update-dialog").showModal();
    } else runAction(button, async () => { renderMaintenance(await post("/api/maintenance", { action: "check" })); void pollMaintenance(); });
  });
  $("cancel-update").addEventListener("click", () => $("update-dialog").close());
  $("confirm-update").addEventListener("click", (event) => runAction(event.currentTarget, async () => {
    renderMaintenance(await post("/api/maintenance", { action: requestedAction })); $("update-dialog").close(); void pollMaintenance();
  }));
  mountIcons();
  void pollMaintenance();
  return { render, openAdd, showDetail, showGallery };
}
