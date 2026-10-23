import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { x as untar } from "tar";
import yauzl from "yauzl";

export async function hashFile(file, algorithm = "sha256", encoding = "hex") {
  const hash = crypto.createHash(algorithm);
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest(encoding);
}

export async function verifyIntegrity(file, expected) {
  const npm = expected.match(/^(sha512)-([A-Za-z0-9+/=]+)$/);
  const github = expected.match(/^(sha256):([a-f0-9]{64})$/);
  if (!npm && !github) throw new Error("Unsupported pinned integrity format");
  const match = npm || github;
  if (await hashFile(file, match[1], npm ? "base64" : "hex") !== match[2]) throw new Error("Tool artifact integrity mismatch: " + path.basename(file));
}

export function safeArchivePath(root, name) {
  if (!name || name.includes("\\") || name.includes(":") || name.includes("\0") || name.startsWith("/") || name.split("/").includes("..")) throw new Error("Unsafe archive path");
  const target = path.resolve(root, name);
  if (target !== path.resolve(root) && !target.startsWith(path.resolve(root) + path.sep)) throw new Error("Archive escapes staging directory");
  return target;
}

async function artifact(cache, spec) {
  if (!/^[a-zA-Z0-9_.-]+$/.test(spec.file)) throw new Error("Invalid tool cache filename");
  const target = path.join(cache, spec.file);
  try { await verifyIntegrity(target, spec.integrity); return target; } catch { /* Missing or incomplete caches are redownloaded and verified. */ }
  const temporary = target + ".download-" + crypto.randomUUID();
  console.log("Downloading pinned official tool: " + spec.file);
  try {
    const response = await fetch(spec.url, { signal: AbortSignal.timeout(600000) });
    if (!response.ok || Number(response.headers.get("content-length")) > 200 * 1024 * 1024) throw new Error("Tool download failed: " + response.status);
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temporary, { flags: "wx" }));
    await verifyIntegrity(temporary, spec.integrity);
    await fsp.copyFile(temporary, target);
    return target;
  } finally { await fsp.rm(temporary, { force: true }); }
}

export async function extractToolArchive(file, directory, include = () => true) {
  await fsp.mkdir(directory, { recursive: true });
  let total = 0;
  let count = 0;
  const accept = (name, size) => {
    const target = safeArchivePath(directory, name);
    total += size;
    if (++count > 30000 || size > 256 * 1024 * 1024 || total > 512 * 1024 * 1024) throw new Error("Tool archive exceeds build limits");
    return target;
  };
  if (!file.endsWith(".zip")) {
    await untar({ file, cwd: directory, strict: true, filter(name, entry) {
      accept(name, Number(entry.size || 0));
      if (!include(name)) return false;
      if (!["File", "Directory"].includes(entry.type)) throw new Error("Tool archives must not contain links or special files");
      return true;
    } });
    return;
  }
  const archive = await yauzl.openPromise(file, { strictFileNames: true, validateEntrySizes: true });
  try {
    for await (const entry of archive.eachEntry()) {
      const target = accept(entry.fileName, entry.uncompressedSize);
      if (!include(entry.fileName)) continue;
      const kind = (entry.externalFileAttributes >>> 16) & 0o170000;
      if (kind && kind !== 0o100000 && kind !== 0o040000) throw new Error("Tool archives must not contain links or special files");
      if (entry.fileName.endsWith("/")) await fsp.mkdir(target, { recursive: true });
      else {
        await fsp.mkdir(path.dirname(target), { recursive: true });
        await pipeline(await archive.openReadStreamPromise(entry), fs.createWriteStream(target, { flags: "wx" }));
      }
    }
  } finally { archive.close(); }
}

async function findFile(root, predicate) {
  for (const entry of await fsp.readdir(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isFile() && predicate(full)) return full;
    if (entry.isDirectory()) { const result = await findFile(full, predicate); if (result) return result; }
  }
  return "";
}

async function skillInventory(root) {
  const result = [];
  for (const entry of await fsp.readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(root, entry.name, "SKILL.md");
    try { result.push({ name: entry.name, sha256: await hashFile(file) }); } catch { /* Shared asset folders are not skills. */ }
  }
  return result;
}

export async function preparePlatformTools(root = process.cwd()) {
  if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Bundled platform tools currently target Windows x64");
  const cache = path.join(root, "build", "runtime-cache");
  const target = path.join(root, "build", "runtime");
  await fsp.mkdir(cache, { recursive: true });
  await fsp.mkdir(target, { recursive: true });
  const pins = JSON.parse(await fsp.readFile(path.join(root, "build", "platform-tools.lock.json"), "utf8"));
  const inventory = {};
  for (const platform of ["wecom", "dingtalk"]) {
    const spec = pins[platform];
    const stage = await fsp.mkdtemp(path.join(cache, "stage-"));
    try {
      const binaryArchive = await artifact(cache, spec.binary);
      const skillsArchive = await artifact(cache, spec.skills);
      await extractToolArchive(binaryArchive, path.join(stage, "binary"));
      await extractToolArchive(skillsArchive, path.join(stage, "skills"), (name) => platform !== "wecom" || /\/skills(?:\/|$)|\/LICENSE$/.test(name));
      const name = platform === "wecom" ? "wecom-cli.exe" : "dws.exe";
      const binary = await findFile(path.join(stage, "binary"), (file) => path.basename(file) === name);
      const shared = platform === "wecom" ? "wecomcli-shared" : "dingtalk-shared";
      const skill = await findFile(path.join(stage, "skills"), (file) => path.basename(file) === "SKILL.md" && path.basename(path.dirname(file)) === shared);
      if (!binary || !skill) throw new Error("Official archive is missing required tool/skills: " + platform);
      const check = spawnSync(binary, platform === "wecom" ? ["--version"] : ["version"], { windowsHide: true, encoding: "utf8", timeout: 15000,
        env: { ...process.env, WECOM_CLI_CONFIG_DIR: path.join(stage, "probe"), DWS_CONFIG_DIR: path.join(stage, "probe") } });
      if (check.status !== 0 || !check.stdout.includes(spec.version)) throw new Error("Bundled native version check failed: " + platform);
      await fsp.copyFile(binary, path.join(target, name));
      const prefix = platform === "wecom" ? "wecomcli-" : "dingtalk-";
      const skillTarget = path.join(target, "skills");
      await fsp.mkdir(skillTarget, { recursive: true });
      for (const entry of await fsp.readdir(skillTarget, { withFileTypes: true })) {
        if (!entry.name.startsWith(prefix)) continue;
        const owned = path.resolve(skillTarget, entry.name);
        if (path.dirname(owned) !== path.resolve(root, "build", "runtime", "skills")) throw new Error("Unsafe bundled-skill cleanup refused");
        await fsp.rm(owned, { recursive: true, force: true });
      }
      await fsp.cp(path.dirname(path.dirname(skill)), path.join(target, "skills"), { recursive: true });
      let license = await findFile(path.join(stage, "binary"), (file) => path.basename(file).toUpperCase() === "LICENSE");
      if (!license) license = await findFile(path.join(stage, "skills"), (file) => path.basename(file).toUpperCase() === "LICENSE");
      const destination = path.join(target, platform === "wecom" ? "WECOM-CLI-LICENSE" : "DINGTALK-CLI-LICENSE");
      if (license) await fsp.copyFile(license, destination);
      else {
        const url = `https://raw.githubusercontent.com/${platform === "wecom" ? "WecomTeam/wecom-cli" : "DingTalk-Real-AI/dingtalk-workspace-cli"}/${spec.skills.commit}/LICENSE`;
        const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
        const text = await response.text();
        if (!response.ok || !/MIT License|Apache License/.test(text)) throw new Error("Pinned license retrieval failed");
        await fsp.writeFile(destination, text);
      }
      const notice = await findFile(path.join(stage, "binary"), (file) => path.basename(file).toUpperCase() === "NOTICE");
      if (notice) await fsp.copyFile(notice, path.join(target, platform === "wecom" ? "WECOM-CLI-NOTICE" : "DINGTALK-CLI-NOTICE"));
      const skills = (await skillInventory(path.join(target, "skills"))).filter((item) => item.name.startsWith(platform === "wecom" ? "wecomcli-" : "dingtalk-"));
      if (!skills.length) throw new Error("Bundled skill inventory is empty");
      inventory[platform] = { version: spec.version, file: name, sha256: await hashFile(path.join(target, name)), source: spec.binary.url,
        skillsCommit: spec.skills.commit, skills };
      console.log(`${platform}: ${spec.version}, ${skills.length} bundled official skills`);
    } finally {
      if (!path.resolve(stage).startsWith(path.resolve(cache) + path.sep) || !path.basename(stage).startsWith("stage-")) throw new Error("Unsafe staging cleanup refused");
      await fsp.rm(stage, { recursive: true, force: true });
    }
  }
  await fsp.writeFile(path.join(target, "platform-tools.json"), JSON.stringify(inventory, null, 2) + "\n");
  return inventory;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await preparePlatformTools();
