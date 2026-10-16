import { spawn } from "node:child_process";
import { buildFeishuCliSpawn } from "./feishuCli.js";

function parseResult(stdout) {
  try { return JSON.parse(stdout.trim()); } catch {
    for (const line of stdout.trim().split(/\r?\n/).reverse()) {
      try { return JSON.parse(line); } catch { /* Skip progress output. */ }
    }
  }
  return null;
}

export function createMaintenanceManager(config, options = {}) {
  let task = { state: "idle", message: "可检查并更新飞书 CLI 与配套技能", result: null };
  let runningChild;
  let closed = false;
  const spawnProcess = options.spawn || spawn;
  function terminate(child) {
    if (!child) return;
    if (process.platform === "win32" && child.pid) {
      const killer = spawnProcess("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      killer.on("error", () => child.kill());
    } else child.kill?.();
  }

  function runCli(args) {
    return new Promise((resolve, reject) => {
      const invocation = buildFeishuCliSpawn(args, { cliBin: config.cli.bin });
      const child = spawnProcess(invocation.command, invocation.args, { windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LARKSUITE_CLI_CONFIG_DIR: config.cli.configDir } });
      runningChild = child;
      let stdout = "";
      child.stdout.on("data", (chunk) => { stdout = (stdout + chunk).slice(-64000); });
      child.stderr.on("data", () => {});
      const timeout = setTimeout(() => {
        terminate(child);
        reject(new Error("更新超时，请检查网络与安装权限后重试"));
      }, 600000);
      timeout.unref();
      child.on("error", () => { clearTimeout(timeout); runningChild = null; reject(new Error("无法启动飞书 CLI，请检查安装路径")); });
      child.on("close", (code) => {
        clearTimeout(timeout); runningChild = null;
        const result = parseResult(stdout);
        if (code !== 0 || result?.ok !== true || /manual|unsupported|failed|error/.test(result.action || "")) {
          reject(new Error("更新未完成，请检查网络、安装权限或手动安装提示"));
        } else resolve(result);
      });
    });
  }

  return {
    getStatus() { return { ...task }; },
    start(action) {
      if (!["check", "update", "skills"].includes(action)) throw new Error("不支持的更新操作");
      if (task.state === "running") throw new Error("已有更新任务正在执行");
      if (closed) throw new Error("管理服务正在关闭");
      const args = ["update", "--json", ...(action === "check" ? ["--check"] : []), ...(action === "skills" ? ["--force"] : [])];
      task = { action, state: "running", startedAt: new Date().toISOString(),
        message: action === "check" ? "正在检查版本" : "正在更新 CLI 与官方飞书技能，请勿关闭服务", result: task.result };
      void runCli(args).then(async (result) => {
        if (closed) return;
        task = { ...task, result };
        if (action !== "check") {
          task.message = "安装已结束，正在核对 CLI 与技能版本";
          const verified = await runCli(["update", "--check", "--json"]);
          if (closed) return;
          task = { ...task, result: verified };
          if (!verified.current_version || verified.current_version !== verified.latest_version) {
            throw new Error("更新后版本尚未确认，请检查安装权限后重试");
          }
          if (verified.skills_status?.in_sync === false) throw new Error("CLI 已处理，但飞书技能尚未同步，请重试更新飞书技能");
        }
        task = { ...task, state: "completed", finishedAt: new Date().toISOString(),
          message: action === "check" ? "版本检查完成" : "CLI 与配套飞书技能更新完成" };
      }).catch((error) => {
        if (!closed) task = { ...task, state: "error", finishedAt: new Date().toISOString(), message: error.message };
      });
      return this.getStatus();
    },
    close() { closed = true; terminate(runningChild); }
  };
}
