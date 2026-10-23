import path from "node:path";

export function isInstallerQuitRequest(argv) {
  return argv.includes("--quit-for-update");
}

export function desktopPaths(userData, resources, packaged) {
  const tools = packaged ? path.join(resources, "tools") : path.join(resources, "build", "runtime");
  return {
    state: path.join(userData, "state"), logs: path.join(userData, "runs"),
    workdir: path.join(userData, "workspace"), cli: path.join(userData, "tools", "lark-cli.exe"),
    bundledCli: path.join(tools, "lark-cli.exe"), codex: path.join(tools, "codex", "bin", "codex.exe"),
    wecom: path.join(tools, "wecom-cli.exe"), dingtalk: path.join(tools, "dws.exe"), skills: path.join(tools, "skills")
  };
}

export function isAppNavigation(value, origin) {
  try { return new URL(value).origin === origin; } catch { return false; }
}

export function isExternalWebLink(value) {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
}
