import { icon, mountIcons, setIconLabel } from "./icons.js";
import { setupConnections } from "./connections.js";
import { renderMarkdown } from "./markdown.js";
import { createAvatarPreferences, renderAvatar, setupAvatarPicker } from "./avatars.js";

mountIcons();
const $ = (id) => document.getElementById(id);
const state = {
  overview: null, selectedBotId: "", selectedSessionKey: "", view: "sessions",
  sessions: [], creating: false, busy: false, refreshPromise: null,
  formKey: null, drafts: new Map(), skillDrafts: new Map(), skills: [], skillsBotId: ""
};
const labels = {
  idle: "未授权", running: "已连接", stopped: "未连接", starting: "连接中", stopping: "断开中",
  queued: "排队中", failed: "失败", error: "异常", completed: "完成", succeeded: "完成",
  authorized: "已授权", cancelled: "已取消", pending: "待授权", waiting_for_authorization: "待授权"
};
const viewCopy = {
  sessions: ["会话", "会话", "查看消息、执行记录与上下文。"],
  connections: ["连接", "连接", "让 Codex 与你的聊天工具相连。"],
  skills: ["技能", "技能", "管理本地技能，为机器人选择能力。"],
  system: ["系统", "设置", "服务、工具更新与运行状态。"]
};
const checkboxNames = ["preferCli", "allowPlainTextInP2P", "attachmentsEnabled", "streamingCardEnabled", "grantRequesterManageAccess", "sessionThreadsEnabled", "replySkillEnabled", "autoStart"];
const form = $("bot-form");
const avatarPreferences = createAvatarPreferences();
const markupCache = new WeakMap();
let toastTimer;

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
function status(value) {
  const raw = String(value || "stopped");
  return '<span class="status-pill status-' + raw.replace(/[^a-z0-9_-]/gi, "-") + '">' + escapeHtml(labels[raw] || raw) + "</span>";
}
function showToast(message, isError = false) {
  $("toast").textContent = message;
  $("toast").classList.toggle("error", isError);
  $("toast").classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("visible"), 3500);
}
async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...options.headers } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "请求失败，请稍后再试");
  return payload;
}
const post = (url, body) => api(url, { method: "POST", body: JSON.stringify(body || {}) });
function selectedBot() { return state.overview?.bots?.find((entry) => entry.bot.id === state.selectedBotId); }
function requireBot() {
  if (!state.selectedBotId || state.creating) throw new Error("请先保存并选择机器人");
  return state.selectedBotId;
}
function formatTime(value, short = false) {
  if (!value) return "暂无记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", ...(short ? {} : { second: "2-digit" }) }).format(date);
}
function empty(title, text = "") {
  return '<div class="empty-state"><span class="empty-symbol" aria-hidden="true">' + icon("chat") + '</span><h2>' + escapeHtml(title) + "</h2><p>" + escapeHtml(text) + "</p></div>";
}
function patchContent(element, html) {
  if (markupCache.get(element) === html) return;
  const scrollTop = element.scrollTop;
  const openKeys = new Set([...element.querySelectorAll("details[open][data-persist-key]")].map((item) => item.dataset.persistKey));
  element.innerHTML = html;
  for (const detail of element.querySelectorAll("details[data-persist-key]")) detail.open = openKeys.has(detail.dataset.persistKey);
  element.scrollTop = scrollTop;
  markupCache.set(element, html);
}
async function runAction(button, action) {
  if (state.busy) return;
  state.busy = true;
  const content = button ? [...button.childNodes] : [];
  if (button) {
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    setIconLabel(button, "loader", button.classList.contains("icon-button") ? "" : "处理中…");
  }
  try {
    if (state.refreshPromise) await state.refreshPromise;
    await action();
  } catch (error) { showToast(error.message, true); }
  finally {
    state.busy = false;
    if (button?.isConnected) {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      button.replaceChildren(...content);
    }
    if (state.overview) renderCli();
  }
}
function setView(view) {
  if (!viewCopy[view]) return;
  state.view = view;
  document.querySelectorAll(".view").forEach((element) => element.hidden = element.id !== "view-" + view);
  document.querySelectorAll("[data-view]").forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
  });
  const [label, title, description] = viewCopy[view];
  $("breadcrumb-current").textContent = label;
  $("page-title").textContent = title;
  $("page-description").textContent = description;
  if (view === "skills") loadSkills().catch((error) => showToast(error.message, true));
}
function renderOverview() {
  const bots = state.overview?.bots || [];
  const running = bots.filter((entry) => entry.service.state === "running").length;
  const cli = state.overview?.cli || {};
  const authorized = cli.authTask?.status === "authorized";
  patchContent($("summary-strip"), '<span class="summary-item"><span class="live-dot"></span><strong>' + running + "/" + bots.length + '</strong> 机器人在线</span><span class="summary-item">飞书 CLI ' + status(authorized ? "authorized" : cli.authTask?.status || "idle") + "</span>");
  const bot = selectedBot()?.bot;
  patchContent($("selected-bot-label"), bot ? '<span class="live-dot ' + (selectedBot().service.state === "running" ? "" : "offline") + '"></span>' + escapeHtml(bot.name) : "");
  patchContent($("bot-list"), bots.length ? bots.map((entry) => {
    const active = entry.bot.id === state.selectedBotId;
    return '<article class="bot-card ' + (active ? "active" : "") + '"><button class="bot-select" data-select-bot="' + escapeHtml(entry.bot.id) + '" aria-pressed="' + active + '"><span class="bot-avatar" aria-hidden="true">' + renderAvatar(avatarPreferences.get(entry.bot.id)) + '</span><span class="bot-info"><strong>' + escapeHtml(entry.bot.name) + "</strong><small>" + status(entry.service.state) + '</small></span></button>' + (active ? '<div class="bot-actions"><button class="text-button" data-service="' + (entry.service.state === "running" ? "stop" : "start") + '">' + icon(entry.service.state === "running" ? "unplug" : "plug") + (entry.service.state === "running" ? "断开" : "连接") + '</button><button class="text-button" data-configure-bot>' + icon("settings") + '设置</button></div>' : "") + "</article>";
  }).join("") : empty("还没有机器人", "点击 + 添加第一个连接"));
  const entry = selectedBot();
  patchContent($("bot-connection-status"), entry ? '<div class="connection-indicator"><span class="live-dot ' + (entry.service.state === "running" ? "" : "offline") + '"></span><div><strong>' + escapeHtml(labels[entry.service.state] || entry.service.state) + '</strong><p>' + escapeHtml(entry.bot.name) + ' · ' + escapeHtml(entry.bot.appId) + '</p><p>运行模型：' + escapeHtml(entry.service.model || "跟随默认") + '</p></div></div>' + (entry.service.configurationChanged ? '<div class="configuration-notice">配置已保存，当前连接仍在使用旧配置。<button class="text-button" data-service="restart">应用新配置</button></div>' : "") + '<div class="control-row"><button class="' + (entry.service.state === "running" ? "ghost-button" : "primary-button") + '" data-service="' + (entry.service.state === "running" ? "stop" : "start") + '">' + icon(entry.service.state === "running" ? "unplug" : "plug") + (entry.service.state === "running" ? "断开连接" : "连接机器人") + '</button><button class="ghost-button" data-service="restart">' + icon("refresh") + '重启</button></div>' : '<p class="muted">保存机器人后即可连接。</p>');
  $("connection-label").textContent = "本地服务已连接";
  $("connection-dot").classList.remove("offline");
  fillBotForm();
  patchContent($("bot-avatar-preview"), renderAvatar(avatarPreferences.get(state.selectedBotId)));
  $("choose-avatar").disabled = !bot || state.creating;
  renderCli();
  renderSystem();
  connections.render();
}
function readForm() {
  const data = Object.fromEntries(new FormData(form));
  for (const name of checkboxNames) data[name] = form.elements.namedItem(name).checked;
  return data;
}
function draftKey() { return state.creating ? "__new__" : state.selectedBotId; }
function fillBotForm(force = false) {
  const key = draftKey();
  if (!force && state.formKey === key) return;
  state.formKey = key;
  const bot = state.creating ? {} : selectedBot()?.bot || {};
  const draft = state.drafts.get(key);
  const data = { ...bot, appSecret: "", ...(draft || {}) };
  for (const field of ["id", "name", "appId", "appSecret", "workdir"]) form.elements.namedItem(field).value = data[field] || "";
  form.elements.namedItem("commandPrefix").value = data.commandPrefix || "/codex";
  form.elements.namedItem("cliIdentity").value = data.cliIdentity || "bot";
  form.elements.namedItem("maxConcurrentJobs").value = data.maxConcurrentJobs || 1;
  for (const name of ["allowedChatIds", "allowedOpenIds"]) form.elements.namedItem(name).value = Array.isArray(data[name]) ? data[name].join(", ") : data[name] || "";
  for (const name of checkboxNames) form.elements.namedItem(name).checked = data[name] ?? true;
  const model = form.elements.namedItem("model");
  const models = state.overview?.models || [];
  model.replaceChildren(new Option("跟随默认", ""));
  for (const entry of models) model.add(new Option(entry.label, entry.id));
  if (data.model && !models.some((entry) => entry.id === data.model)) model.add(new Option(data.model + "（当前配置）", data.model));
  model.value = data.model || "";
  $("editor-title").textContent = state.creating ? "添加机器人" : "机器人设置";
  $("draft-label").hidden = !draft;
}
function renderCli() {
  const cli = state.overview?.cli || {};
  const task = cli.authTask || {};
  const pending = cli.pendingAuth || {};
  const inProgress = ["running", "starting", "pending", "waiting_for_authorization"].includes(task.status);
  $("cli-cancel").hidden = !inProgress;
  setIconLabel($("cli-authorize"), "shield", task.status === "authorized" ? "重新授权" : "去授权");
  $("cli-configure").disabled = !state.selectedBotId || inProgress || state.overview?.maintenance?.state === "running";
  $("cli-authorize").disabled = !state.selectedBotId || inProgress || state.overview?.maintenance?.state === "running";
  const url = task.verificationUrl || pending.verificationUrl || "";
  const safeUrl = /^https?:\/\//i.test(url) ? url : "";
  patchContent($("cli-status"), '<div>' + status(task.status || "idle") + '</div>' +
    (safeUrl && task.status !== "authorized" ? '<a class="auth-link" href="' + escapeHtml(safeUrl) + '" target="_blank" rel="noreferrer">打开飞书授权页面 ' + icon("external") + '</a>' : "") +
    (task.verificationQrDataUrl?.startsWith("data:image/") && inProgress ? '<img class="auth-qr" src="' + escapeHtml(task.verificationQrDataUrl) + '" alt="飞书授权二维码" />' : "") +
    '<details data-persist-key="cli-details"><summary>' + icon("chevron") + '查看授权详情</summary><div class="metadata"><div><span>当前应用</span><code>' + escapeHtml(cli.configuredAppId || "未配置") + '</code></div><div><span>身份</span><code>' + escapeHtml(cli.authStatus?.identity || "bot") + '</code></div><div><span>Token 状态</span><code>' + escapeHtml(cli.authStatus?.tokenStatus || cli.authStatus?.error || "未返回") + '</code></div><div><span>配置目录</span><code>' + escapeHtml(cli.configDir || "-") + "</code></div></div>" + (task.logTail ? "<pre>" + escapeHtml(task.logTail) + "</pre>" : "") + "</details>");
}
function renderSystem() {
  const system = state.overview?.system || {};
  const rows = [["Node", system.nodeVersion], ["平台", system.platform], ["管理地址", (system.managerHost || "") + ":" + (system.managerPort || "")], ["工作目录", system.workdir], ["状态目录", system.stateDir], ["日志目录", system.logDir], ["CLI 配置", system.cliConfigDir]];
  patchContent($("system-status"), '<div class="metadata">' + rows.map(([key, value]) => "<div><span>" + key + "</span><code>" + escapeHtml(value || "-") + "</code></div>").join("") + "</div>");
  patchContent($("service-logs"), selectedBot()?.logs?.length ? [...selectedBot().logs].reverse().map((log) => '<article class="log-entry"><time>' + escapeHtml(formatTime(log.timestamp)) + "</time><strong>" + escapeHtml(log.level || log.state || "info") + "</strong> " + escapeHtml(log.message || log.state || "") + "</article>").join("") : empty("暂无运行日志", "连接机器人后，可在这里查看活动记录"));
}
function sessionTitle(session) {
  const first = (session.history || []).find((entry) => entry.userPrompt?.trim());
  return first?.userPrompt?.replace(/\s+/g, " ").slice(0, 46) || (session.sessionKey?.startsWith("p2p:") ? "私聊" : "群聊");
}
function filteredSessions() {
  const query = $("session-search").value.trim().toLowerCase();
  const filter = $("session-filter").value;
  return state.sessions.filter((session) => {
    const latest = session.history?.at(-1);
    const failed = ["failed", "error"].includes(latest?.status);
    const completed = ["completed", "succeeded", "success"].includes(latest?.status);
    if (filter === "failed" && !failed || filter === "completed" && !completed) return false;
    return !query || [session.sessionKey, ...session.history.flatMap((entry) => [entry.userPrompt, entry.responseSummary, entry.responseText, entry.errorText])].join(" ").toLowerCase().includes(query);
  });
}
async function renderSessionList() {
  const sessions = filteredSessions();
  $("session-count").textContent = state.sessions.length;
  if (!sessions.some((session) => session.sessionKey === state.selectedSessionKey)) {
    state.selectedSessionKey = sessions[0]?.sessionKey || "";
    markupCache.delete($("session-detail"));
    $("session-detail").scrollTop = 0;
  }
  patchContent($("session-list"), sessions.length ? sessions.map((session) => {
    const latest = session.history?.at(-1);
    return '<button class="session-card ' + (session.sessionKey === state.selectedSessionKey ? "active" : "") + '" data-session-key="' + escapeHtml(session.sessionKey) + '" aria-pressed="' + (session.sessionKey === state.selectedSessionKey) + '"><div class="session-card-head"><strong>' + escapeHtml(sessionTitle(session)) + "</strong>" + status(latest?.status || "idle") + "</div><p>" + escapeHtml(latest?.responseSummary || latest?.userPrompt || "暂无消息") + '</p><footer><span>' + (session.sessionKey.startsWith("p2p:") ? "私聊" : "群聊") + " · " + (session.history?.length || 0) + " 次对话</span><time>" + escapeHtml(formatTime(session.updatedAt, true)) + "</time></footer></button>";
  }).join("") : empty(state.sessions.length ? "没有匹配的会话" : "还没有会话", state.sessions.length ? "试试其他关键词或状态" : "给已连接的机器人发送一条消息"));
  if (state.selectedSessionKey) await renderSessionDetail();
  else patchContent($("session-detail"), empty("从一段对话开始", state.sessions.length ? "调整筛选条件，找到你要查看的会话。" : "给已连接的机器人发送消息，就能在这里查看历史。"));
}
function errorDescription(error) {
  const unsupported = String(error).match(/The ['"]([^'"]+)['"] model is not supported/i);
  if (unsupported) return "当前账号不支持模型 " + unsupported[1] + "。请在连接设置选择可用模型并点击“保存并连接”。";
  if (/service_tier/.test(error) && /default/.test(error)) return "执行配置不兼容，任务未开始。修复配置后，请在飞书中重新发送消息。";
  if (/ENOENT|directory|目录名称无效/.test(error)) return "工作目录或程序路径不可用，请在连接设置中检查。";
  return "这次执行未完成。可以展开错误详情，修复后在飞书重试。";
}
async function renderSessionDetail() {
  const botId = state.selectedBotId;
  const key = state.selectedSessionKey;
  if (!botId || !key) return;
  const payload = await api("/api/session?botId=" + encodeURIComponent(botId) + "&sessionKey=" + encodeURIComponent(key));
  if (botId !== state.selectedBotId || key !== state.selectedSessionKey) return;
  const session = payload.session;
  if (!session) return patchContent($("session-detail"), empty("会话已不存在", "刷新后重新选择会话"));
  const history = [...(session.history || [])].reverse();
  const avatarId = avatarPreferences.get(botId);
  const assistantAvatar = avatarId === "robot" ? icon("codex") : renderAvatar(avatarId);
  const html = '<div class="conversation-heading"><div><h2>' + escapeHtml(sessionTitle(session)) + '</h2><p>' + escapeHtml(selectedBot()?.bot.name || "") + " · " + (session.sessionKey.startsWith("p2p:") ? "私聊" : "群聊") + " · " + history.length + ' 次对话</p></div><div class="control-row"><button class="text-button" data-copy-session>' + icon("copy") + '复制标识</button><button class="ghost-button" data-compress-session' + (!history.length ? " disabled" : "") + '> ' + icon("compress") + '压缩上下文</button></div></div><div class="conversation-body"><details class="context-summary" data-persist-key="context"><summary>' + icon("chevron") + '上下文摘要<span>' + (session.compressionCount ? "已压缩 " + session.compressionCount + " 次" : "尚未压缩") + '</span></summary><div><pre>' + escapeHtml(session.compressedSummary || "对话变长后，可压缩为摘要，让后续对话更轻量。") + '</pre><div class="metadata"><div><span>会话标识</span><code>' + escapeHtml(session.sessionKey) + '</code></div><div><span>当前线程</span><code>' + escapeHtml(session.threadId || "下次消息创建新线程") + '</code></div><div><span>最近压缩</span><code>' + escapeHtml(formatTime(session.compressedAt)) + '</code></div></div></div></details><div class="history-list">' + (history.length ? history.map((entry, index) => {
    const failed = ["failed", "error"].includes(entry.status) || Boolean(entry.errorText);
    const response = entry.responseText || entry.responseSummary || (failed ? "" : "等待执行结果…");
    return '<article class="history-entry"><div class="history-time"><time>' + escapeHtml(formatTime(entry.createdAt)) + "</time>" + status(entry.status || "queued") + '</div><div class="message"><span class="message-avatar" aria-hidden="true">' + icon("user") + '</span><div><div class="message-label">请求</div><div class="message-content">' + escapeHtml(entry.userPrompt || "-") + '</div></div></div><div class="message assistant ' + (failed ? "error" : "") + '"><span class="message-avatar" aria-hidden="true">' + assistantAvatar + '</span><div><div class="message-label">' + (failed ? "执行失败" : "Codex") + '</div><div class="message-content markdown-content">' + (failed ? escapeHtml(errorDescription(entry.errorText || response)) : renderMarkdown(response)) + (failed ? '<details class="error-details" data-persist-key="error-' + escapeHtml(entry.createdAt || index) + '"><summary>' + icon("chevron") + '错误详情</summary><pre>' + escapeHtml(entry.errorText || response || "未返回错误详情") + "</pre></details>" : "") + "</div></div></div></article>";
  }).join("") : empty("暂无历史记录")) + "</div></div>";
  patchContent($("session-detail"), html);
}
async function loadSessions() {
  const botId = state.selectedBotId;
  if (!botId) { state.sessions = []; return renderSessionList(); }
  const payload = await api("/api/sessions?botId=" + encodeURIComponent(botId));
  if (botId !== state.selectedBotId) return;
  state.sessions = (payload.sessions || []).map((session) => ({ ...session, history: session.history || [] })).sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  await renderSessionList();
}
async function loadSkills() {
  const botId = state.selectedBotId;
  if (!botId) { $("skills-list").innerHTML = empty("先添加一个机器人"); $("skill-count").textContent = ""; return; }
  if (state.skillsBotId !== botId) {
    const payload = await api("/api/skills?botId=" + encodeURIComponent(botId));
    if (botId !== state.selectedBotId) return;
    state.skills = payload.skills || [];
    state.skillsBotId = botId;
    $("reply-skill-config").textContent = selectedBot()?.bot.replySkillEnabled ? "回复技能已启用 · " + (selectedBot()?.bot.replySkillPath || payload.replySkillDefault || "") : "回复技能已关闭";
  }
  renderSkills();
}
function renderSkills() {
  const query = $("skill-search").value.trim().toLowerCase();
  const draft = state.skillDrafts.get(state.selectedBotId);
  $("skill-count").textContent = (draft ? draft.size : state.skills.filter((skill) => skill.selected).length) + " 个已选择";
  patchContent($("skills-list"), state.skills.length ? state.skills.map((skill) => {
    const selected = draft ? draft.has(skill.path) : skill.selected;
    const visible = !query || (skill.name + " " + skill.description).toLowerCase().includes(query);
    return '<label class="skill-row"' + (visible ? "" : " hidden") + '><input type="checkbox" value="' + escapeHtml(skill.path) + '"' + (selected ? " checked" : "") + ' /><div><strong>' + escapeHtml(skill.name) + '</strong><div class="skill-meta">' + escapeHtml(skill.description || "暂无描述") + '</div><div class="skill-meta" title="' + escapeHtml(skill.path) + '">' + escapeHtml(skill.source || "本地") + "</div></div></label>";
  }).join("") : empty("没有找到技能"));
  const visibleCount = $("skills-list").querySelectorAll(".skill-row:not([hidden])").length;
  if (state.skills.length && !visibleCount) patchContent($("skills-list"), empty("没有匹配的技能", "试试其他关键词"));
}
async function refreshAll() {
  if (state.refreshPromise) return state.refreshPromise;
  state.refreshPromise = (async () => {
    state.overview = await api("/api/overview");
    if (!state.creating && !state.overview.bots.some((entry) => entry.bot.id === state.selectedBotId)) state.selectedBotId = state.overview.bots[0]?.bot.id || "";
    renderOverview();
    await loadSessions();
    if (state.view === "skills") await loadSkills();
  })();
  try { await state.refreshPromise; } finally { state.refreshPromise = null; }
}
async function saveBot(connect) {
  if (!form.reportValidity()) return;
  const data = readForm();
  if (!data.id && !data.appSecret.trim()) throw new Error("添加机器人需要填写 App Secret");
  const key = draftKey();
  const payload = { ...data, id: data.id || undefined, maxConcurrentJobs: Number(data.maxConcurrentJobs || 1) };
  for (const name of ["allowedChatIds", "allowedOpenIds"]) payload[name] = data[name].split(",").map((part) => part.trim()).filter(Boolean);
  const result = await post("/api/bots", payload);
  state.drafts.delete(key);
  state.selectedBotId = result.bot.id;
  state.creating = false;
  state.formKey = null;
  if (connect) {
    try { await post("/api/bots/" + encodeURIComponent(result.bot.id) + "/service", { action: "start" }); }
    catch (error) { await refreshAll(); throw new Error("配置已保存，连接失败：" + error.message); }
  }
  await refreshAll();
  showToast(connect ? "已保存并应用最新配置" : selectedBot()?.service.configurationChanged ? "配置已保存，点击“应用新配置”后生效" : "配置已保存");
}
async function selectBot(id) {
  state.selectedBotId = id;
  state.selectedSessionKey = "";
  state.creating = false;
  $("session-search").value = "";
  $("session-filter").value = "all";
  markupCache.delete($("session-detail"));
  $("session-detail").scrollTop = 0;
  renderOverview();
  await loadSessions();
  if (state.view === "skills") await loadSkills();
}
document.querySelector(".navigation").addEventListener("click", (event) => {
  const target = event.target.closest("[data-view]");
  if (target) setView(target.dataset.view);
});
form.addEventListener("input", () => { state.drafts.set(draftKey(), readForm()); $("draft-label").hidden = false; });
form.addEventListener("change", () => { state.drafts.set(draftKey(), readForm()); $("draft-label").hidden = false; });
form.addEventListener("submit", (event) => { event.preventDefault(); runAction(event.submitter, () => saveBot(false)); });
$("save-and-start").addEventListener("click", (event) => runAction(event.currentTarget, () => saveBot(true)));
$("new-bot").addEventListener("click", () => { if (!state.busy) connections.openAdd(); });
document.addEventListener("click", (event) => {
  const select = event.target.closest("[data-select-bot]");
  const service = event.target.closest("[data-service]");
  const settings = event.target.closest("[data-configure-bot]");
  if (select && !state.busy) selectBot(select.dataset.selectBot).catch((error) => showToast(error.message, true));
  if (settings) { setView("connections"); connections.showDetail(); }
  if (service) runAction(service, async () => {
    const botId = requireBot();
    await post("/api/bots/" + encodeURIComponent(botId) + "/service", { action: service.dataset.service });
    await refreshAll();
    showToast({ start: "机器人已连接", stop: "机器人已断开", restart: "机器人已重启" }[service.dataset.service]);
  });
});
$("refresh-overview").addEventListener("click", (event) => runAction(event.currentTarget, async () => { await refreshAll(); showToast("状态已刷新"); }));
$("session-search").addEventListener("input", () => renderSessionList().catch((error) => showToast(error.message, true)));
$("session-filter").addEventListener("change", () => renderSessionList().catch((error) => showToast(error.message, true)));
$("session-list").addEventListener("click", (event) => {
  const target = event.target.closest("[data-session-key]");
  if (!target || state.busy) return;
  state.selectedSessionKey = target.dataset.sessionKey;
  markupCache.delete($("session-detail"));
  $("session-detail").scrollTop = 0;
  renderSessionList().catch((error) => showToast(error.message, true));
});
$("session-detail").addEventListener("click", (event) => {
  const copyCode = event.target.closest("[data-copy-code]");
  if (copyCode) runAction(copyCode, async () => {
    await navigator.clipboard.writeText(copyCode.closest(".code-block").querySelector("pre code").textContent);
    showToast("代码已复制");
  });
  if (event.target.closest("[data-copy-session]")) runAction(event.target.closest("button"), async () => {
    await navigator.clipboard.writeText(state.selectedSessionKey);
    showToast("会话标识已复制");
  });
  if (event.target.closest("[data-compress-session]")) $("compress-dialog").showModal();
});
$("confirm-compress").addEventListener("click", (event) => runAction(event.currentTarget, async () => {
  await post("/api/session/compress", { botId: requireBot(), sessionKey: state.selectedSessionKey });
  $("compress-dialog").close();
  await loadSessions();
  showToast("已压缩上下文，下次消息将带着摘要开启新线程");
}));
$("cancel-compress").addEventListener("click", () => $("compress-dialog").close());
$("cli-configure").addEventListener("click", (event) => runAction(event.currentTarget, async () => {
  await post("/api/cli/configure", { botId: requireBot() });
  await refreshAll();
  showToast("CLI 已连接到当前机器人，下一步可进行飞书授权");
}));
$("cli-authorize").addEventListener("click", (event) => runAction(event.currentTarget, async () => {
  await post("/api/cli/configure", { botId: requireBot() });
  await post("/api/cli/auth/start", { domains: ["docs", "base", "calendar", "task", "im", "sheets"], recommend: true });
  await refreshAll();
  showToast("授权已发起，请点击授权链接或扫码完成");
}));
$("cli-cancel").addEventListener("click", (event) => runAction(event.currentTarget, async () => {
  await post("/api/cli/auth/cancel"); await refreshAll(); showToast("授权已取消");
}));
$("skill-search").addEventListener("input", renderSkills);
$("skills-list").addEventListener("change", () => {
  const selected = new Set(state.skills.filter((skill) => skill.selected).map((skill) => skill.path));
  const draft = state.skillDrafts.get(state.selectedBotId) || selected;
  for (const input of $("skills-list").querySelectorAll("input[type=checkbox]")) {
    if (input.checked) draft.add(input.value); else draft.delete(input.value);
  }
  state.skillDrafts.set(state.selectedBotId, draft);
  $("skill-count").textContent = draft.size + " 个已选择 · 未保存";
});
$("save-skills").addEventListener("click", (event) => runAction(event.currentTarget, async () => {
  const id = requireBot();
  const bot = selectedBot().bot;
  const selected = state.skillDrafts.get(id) || new Set(state.skills.filter((skill) => skill.selected).map((skill) => skill.path));
  await post("/api/bots/" + encodeURIComponent(id) + "/skills", { preferredSkills: [...selected], replySkillEnabled: bot.replySkillEnabled, replySkillPath: bot.replySkillPath || "" });
  state.skillDrafts.delete(id);
  state.skillsBotId = "";
  await loadSkills();
  showToast("技能偏好已保存");
}));
for (const [id, action] of [["start-all-services", "startAll"], ["stop-all-services", "stopAll"], ["restart-all-services", "restartAll"]]) {
  $(id).addEventListener("click", (event) => runAction(event.currentTarget, async () => {
    await post("/api/services", { action }); await refreshAll(); showToast("全部服务状态已更新");
  }));
}
window.addEventListener("beforeunload", (event) => {
  if (state.drafts.size || state.skillDrafts.size) { event.preventDefault(); event.returnValue = ""; }
});
setInterval(() => {
  if (document.visibilityState !== "visible" || state.busy || $("compress-dialog").open) return;
  refreshAll().catch(() => { $("connection-dot").classList.add("offline"); $("connection-label").textContent = "连接中断，稍后自动重试"; });
}, 15000);
const connections = setupConnections({ $, state, api, post, escapeHtml, status, selectedBot, selectBot, setView, refreshAll, showToast, runAction, patchContent, avatarPreferences });
setupAvatarPicker({ preferences: avatarPreferences, getBotId: () => state.creating ? "" : state.selectedBotId, onChange(persisted) {
  renderOverview();
  showToast(persisted ? "头像已更换" : "头像已更换，但浏览器禁止存储，关闭页面后可能丢失", !persisted);
  void renderSessionDetail().catch((error) => showToast(error.message, true));
} });
window.addEventListener("storage", (event) => {
  if ((!event.key || event.key.startsWith("bridge-avatar:")) && state.overview) {
    renderOverview();
    void renderSessionDetail().catch((error) => showToast(error.message, true));
  }
});
document.querySelector('[data-view="connections"]').addEventListener("click", () => connections.showGallery());
refreshAll().then(() => { if (!state.selectedBotId) setView("connections"); }).catch((error) => {
  $("connection-label").textContent = "管理服务不可用";
  $("connection-dot").classList.add("offline");
  showToast(error.message, true);
});
