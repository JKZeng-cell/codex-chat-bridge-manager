import fs from "node:fs/promises";
import { spawn } from "node:child_process";

// New CLI versions keep app secrets in the current user's Windows DPAPI store.
export async function resolveCliSecret(app) {
  if (typeof app?.appSecret === "string") return app.appSecret;
  const ref = app?.appSecret;
  if (ref?.source === "file") return (await fs.readFile(ref.id, "utf8")).trim();
  if (ref?.source !== "keychain" || ref.id !== `appsecret:${app.appId}` || process.platform !== "win32") {
    throw new Error("当前系统无法读取 CLI 机器人密钥，请使用手动接入");
  }
  const script = [
    "$ErrorActionPreference='Stop'",
    "Add-Type -AssemblyName System.Security",
    "$account=[Console]::In.ReadToEnd().Trim()",
    "$name=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($account)).TrimEnd('=').Replace('+','-').Replace('/','_')",
    "$key=Get-Item -LiteralPath 'HKCU:\\Software\\LarkCli\\keychain\\lark-cli'",
    "$cipher=[Convert]::FromBase64String($key.GetValue($name))",
    "$entropy=[Text.Encoding]::UTF8.GetBytes('lark-cli'+[char]0+$account)",
    "$plain=[Security.Cryptography.ProtectedData]::Unprotect($cipher,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)",
    "[Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain))"
  ].join("\n");
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
    let value = "";
    child.stdout.on("data", (chunk) => { value += chunk; });
    child.on("error", () => reject(new Error("无法读取系统密钥库")));
    child.on("close", (code) => code === 0 && value.trim() ? resolve(value.trim()) : reject(new Error("无法读取机器人密钥")));
    child.stdin.end(ref.id);
  });
}
