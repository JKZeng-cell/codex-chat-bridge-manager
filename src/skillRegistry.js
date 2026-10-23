import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

function parseFrontMatter(text) {
  const match = text.match(/^---\s*\n([\s\S]*?)\n---/);
  const frontMatter = {};

  if (!match) {
    return frontMatter;
  }

  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator < 0) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^"|"$/g, "");
    frontMatter[key] = value;
  }

  return frontMatter;
}

async function findSkillFiles(rootDir, bucket) {
  let entries = [];

  try {
    entries = await fsp.readdir(rootDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const skillPath = path.join(rootDir, entry.name, "SKILL.md");
    try {
      await fsp.access(skillPath);
      bucket.push(skillPath);
    } catch {
      // Ignore folders without a SKILL.md.
    }
  }
}

function findSkillFilesSync(rootDir, bucket) {
  let entries = [];

  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const skillPath = path.join(rootDir, entry.name, "SKILL.md");
    if (fs.existsSync(skillPath)) {
      bucket.push(skillPath);
    }
  }
}

function resolveSkillSource(normalizedRoot) {
  return normalizedRoot.includes(".agents\\skills") || normalizedRoot.includes(".agents/skills")
    ? "agents"
    : "codex";
}

function buildSkillRecord({ raw, skillPath, roots, options }) {
  const normalizedRoots = roots || [];
  const frontMatter = parseFrontMatter(raw);
  const description = frontMatter.description || raw.split(/\r?\n/).slice(0, 8).join(" ").trim();
  const normalizedRoot = normalizedRoots.find((root) => skillPath.startsWith(root)) || "";
  const source = options.bundledRoots?.includes(normalizedRoot) ? "builtin" : resolveSkillSource(normalizedRoot);

  return {
    id: path.relative(normalizedRoot || path.dirname(skillPath), skillPath).replace(/\\/g, "/"),
    name: frontMatter.name || path.basename(path.dirname(skillPath)),
    description,
    path: skillPath,
    source,
    selected: Array.isArray(options.selectedPaths) ? options.selectedPaths.includes(skillPath) : false,
    isReplySkill: options.replySkillPath ? options.replySkillPath === skillPath : false
  };
}

function sortSkills(skills) {
  return skills.sort((left, right) => {
    if (left.source !== right.source) {
      return left.source.localeCompare(right.source);
    }

    return left.name.localeCompare(right.name);
  });
}

export async function listSkills(roots, options = {}) {
  const normalizedRoots = roots || [];
  const bucket = [];
  for (const root of normalizedRoots) {
    await findSkillFiles(root, bucket);
  }

  const skills = await Promise.all(
    bucket.map(async (skillPath) => {
      const raw = await fsp.readFile(skillPath, "utf8");
      return buildSkillRecord({ raw, skillPath, roots: normalizedRoots, options });
    })
  );

  return sortSkills(skills);
}

export function listSkillsSync(roots, options = {}) {
  const normalizedRoots = roots || [];
  const bucket = [];
  for (const root of normalizedRoots) {
    findSkillFilesSync(root, bucket);
  }

  const skills = [];
  for (const skillPath of bucket) {
    try {
      const raw = fs.readFileSync(skillPath, "utf8");
      skills.push(buildSkillRecord({ raw, skillPath, roots: normalizedRoots, options }));
    } catch {
      // Ignore unreadable skills so one broken install does not disable the bridge.
    }
  }

  return sortSkills(skills);
}

function compactDescription(description, maxChars) {
  const oneLine = String(description || "")
    .replace(/\s+/g, " ")
    .trim();

  if (oneLine.length <= maxChars) {
    return oneLine;
  }

  return `${oneLine.slice(0, Math.max(0, maxChars - 1)).trim()}...`;
}

export function buildInstalledLarkSkillContext(roots, options = {}) {
  const maxSkills = options.maxSkills ?? 40;
  const maxDescriptionChars = options.maxDescriptionChars ?? 220;
  const skills = listSkillsSync(roots, options)
    .filter((skill) => skill.name.startsWith("lark-"))
    .slice(0, maxSkills);

  if (!skills.length) {
    return "";
  }

  return [
    "Installed Feishu/Lark skills:",
    "- Read the matching `SKILL.md` before domain-specific Feishu work; read `lark-shared` first for auth, identity, permission, update, and high-risk write rules.",
    ...skills.map((skill) => {
      const description = compactDescription(skill.description, maxDescriptionChars);
      return `- ${skill.name}: ${description} (${skill.path})`;
    })
  ].join("\n");
}
