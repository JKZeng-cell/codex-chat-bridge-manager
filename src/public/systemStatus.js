export function formatUptime(value) {
  const seconds = Math.max(0, Math.floor((Number(value) || 0) / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor(seconds % 86400 / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  if (days) return `${days} 天 ${hours} 小时`;
  if (hours) return `${hours} 小时 ${minutes} 分钟`;
  if (minutes) return `${minutes} 分钟 ${seconds % 60} 秒`;
  return `${seconds} 秒`;
}

export function summarizeServices(bots = []) {
  return bots.reduce((result, { service = {} }) => {
    result.total++;
    if (service.state === "running") result.running++;
    if (["error", "failed"].includes(service.state)) result.errors++;
    result.active += Number(service.queue?.activeCount) || 0;
    result.pending += Number(service.queue?.pendingCount) || 0;
    return result;
  }, { total: 0, running: 0, errors: 0, active: 0, pending: 0 });
}

export function describeCodexStatus(codex = {}) {
  if (codex.checking && !codex.checkedAt) return { label: "检测中", tone: "neutral", hint: "正在读取本机 CLI 与登录状态。" };
  const states = {
    ready: { label: "已就绪", tone: "success", hint: "CLI 可用且已登录；模型权限与网络连通性以实际任务为准。" },
    unauthorized: { label: "未登录", tone: "warning", hint: "请先完成 Codex 登录。桌面版：应用 → Codex 登录；源码版：npx codex login。" },
    unavailable: { label: "不可用", tone: "bad", hint: "无法运行配置的 Codex CLI，请检查安装与执行路径。" },
    timeout: { label: "检测超时", tone: "warning", hint: "本地 CLI 未及时响应，请稍后重新检测。" },
    unknown: { label: "状态未知", tone: "warning", hint: "无法确认登录状态，请检查 CLI 配置并重新检测。" },
    unchecked: { label: "未检测", tone: "neutral", hint: "npx 模式不自动下载或执行工具。请在终端确认 Codex 状态。" }
  };
  return states[codex.state] || { label: "等待检测", tone: "neutral", hint: "尚未获取检测结果；若刚更新程序，请重启管理服务。" };
}
