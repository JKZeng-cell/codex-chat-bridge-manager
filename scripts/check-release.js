import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
if (!files.length) throw new Error("No tracked release files; stage the public source first.");
const forbidden = /(^|\/)(node_modules|state|runs|pet-runs|coverage)(\/|$)|(^|\/)\.env(?!\.example$)|\.(log|tgz|zip)$/;
const sensitive = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-(?:proj-)?[A-Za-z0-9_-]{30,}|\bgh[pousr]_[A-Za-z0-9]{30,}/;
for (const file of files) {
  if (forbidden.test(file)) throw new Error(`Private runtime file tracked: ${file}`);
  if (/\.(png|jpe?g|webp)$/i.test(file)) continue;
  const content = fs.readFileSync(file, "utf8");
  if (sensitive.test(content)) throw new Error(`Possible credential in ${file}`);
  if (file.endsWith(".md")) {
    for (const match of content.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1].split("#")[0];
      if (!target || /^(https?:|mailto:)/.test(target)) continue;
      if (!fs.existsSync(path.resolve(path.dirname(file), target))) throw new Error(`Broken link in ${file}: ${target}`);
    }
  }
}
console.log(`Release check passed: ${files.length} tracked files, no forbidden runtime paths or recognized credential patterns, local documentation links valid.`);
