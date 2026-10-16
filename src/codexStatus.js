import { execFile } from "node:child_process";

export function buildCodexStatusCommand(codex, args, platform = process.platform) {
  if (codex.cliMode === "npx") return null;
  const prefix = codex.cliMode === "local" ? [codex.localCliPath] : [];
  if (platform === "win32" && !prefix.length && !/\.(exe|com)$/i.test(codex.cliBin)) {
    if (/[\r\n"&|<>^%!]/.test(codex.cliBin)) throw new Error("Unsafe CLI path");
    return { command: "cmd.exe", args: ["/d", "/s", "/c", `""${codex.cliBin}" ${args.join(" ")}"`] };
  }
  return { command: codex.cliBin, args: [...prefix, ...args] };
}

function runCommand(command, args) {
  return new Promise((resolve) => {
    execFile(command, args, { windowsHide: true, timeout: 5000, maxBuffer: 65536, env: process.env }, (error, stdout, stderr) => {
      resolve({ code: error ? error.code ?? 1 : 0, timedOut: Boolean(error?.killed), output: `${stdout || ""}\n${stderr || ""}` });
    });
  });
}

export function createCodexStatusMonitor(config, options = {}) {
  const run = options.run || runCommand;
  const now = options.now || Date.now;
  const ttlMs = options.ttlMs ?? 30000;
  let snapshot = { state: "unchecked", version: "", authMode: "", checkedAt: "", checking: false };
  let lastChecked = null;
  let pending;

  async function check() {
    const versionCommand = buildCodexStatusCommand(config.codex, ["--version"]);
    if (!versionCommand) return { state: "unchecked", version: "", authMode: "" };
    const versionResult = await run(versionCommand.command, versionCommand.args);
    if (versionResult.code !== 0) return { state: versionResult.timedOut ? "timeout" : "unavailable", version: "", authMode: "" };
    const version = versionResult.output.match(/codex(?:-cli)?\s+(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/i)?.[1] || "";
    const authCommand = buildCodexStatusCommand(config.codex, ["login", "status"]);
    const authResult = await run(authCommand.command, authCommand.args);
    if (authResult.timedOut) return { state: "timeout", version, authMode: "" };
    if (/not logged in/i.test(authResult.output)) return { state: "unauthorized", version, authMode: "" };
    if (authResult.code === 0 && /logged in/i.test(authResult.output)) {
      return { state: "ready", version, authMode: /chatgpt/i.test(authResult.output) ? "ChatGPT" : /api key/i.test(authResult.output) ? "API Key" : "CLI" };
    }
    return { state: "unknown", version, authMode: "" };
  }

  function refresh() {
    if (pending) return pending;
    snapshot = { ...snapshot, checking: true };
    pending = check().catch(() => ({ state: "unknown", version: "", authMode: "" })).then((result) => {
      lastChecked = now();
      snapshot = { ...result, checkedAt: new Date(lastChecked).toISOString(), checking: false };
      return { ...snapshot };
    }).finally(() => { pending = null; });
    return pending;
  }

  return {
    getStatus() {
      if (lastChecked === null || now() - lastChecked >= ttlMs) void refresh();
      return { ...snapshot };
    },
    refresh
  };
}
