import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { buildFeishuCliSpawn } from "./feishuCli.js";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".ico"]);
const AUDIO_EXTENSIONS = new Set([
  ".mp3",
  ".wav",
  ".m4a",
  ".aac",
  ".ogg",
  ".opus",
  ".amr",
  ".flac",
  ".wma"
]);
const CONTENT_TYPE_EXTENSION_MAP = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/jpg", ".jpg"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
  ["image/bmp", ".bmp"],
  ["image/tiff", ".tiff"],
  ["image/x-icon", ".ico"],
  ["audio/mpeg", ".mp3"],
  ["audio/mp3", ".mp3"],
  ["audio/wav", ".wav"],
  ["audio/x-wav", ".wav"],
  ["audio/aac", ".aac"],
  ["audio/mp4", ".m4a"],
  ["audio/m4a", ".m4a"],
  ["audio/ogg", ".ogg"],
  ["audio/opus", ".opus"],
  ["audio/amr", ".amr"],
  ["audio/flac", ".flac"],
  ["application/pdf", ".pdf"],
  ["text/plain", ".txt"],
  ["application/json", ".json"],
  ["application/zip", ".zip"]
]);

export const FEISHU_ATTACHMENTS_BLOCK = "feishu_attachments";

function getHeader(headers, name) {
  if (!headers) {
    return "";
  }

  if (typeof headers.get === "function") {
    return headers.get(name) || "";
  }

  const value = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function sanitizeFileName(name, fallback = "attachment") {
  const normalized = String(name || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim();

  return normalized || fallback;
}

export function sanitizeAttachmentStorageName(name, fallback = "session") {
  return sanitizeFileName(name, fallback).replace(/\.+$/g, "").trim() || fallback;
}

function inferExtensionFromContentType(contentType, fallback = "") {
  const normalized = String(contentType || "").split(";")[0].trim().toLowerCase();
  return CONTENT_TYPE_EXTENSION_MAP.get(normalized) || fallback;
}

function inferFileNameFromHeaders(headers) {
  const contentDisposition = getHeader(headers, "content-disposition");
  if (!contentDisposition) {
    return "";
  }

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }

  const quotedMatch = contentDisposition.match(/filename="([^"]+)"/i);
  if (quotedMatch?.[1]) {
    return quotedMatch[1];
  }

  const plainMatch = contentDisposition.match(/filename=([^;]+)/i);
  return plainMatch?.[1]?.trim() || "";
}

function ensureExtension(fileName, contentType, fallbackExtension) {
  const currentExtension = path.extname(fileName);
  if (currentExtension) {
    return fileName;
  }

  const inferred = inferExtensionFromContentType(contentType, fallbackExtension);
  return inferred ? `${fileName}${inferred}` : fileName;
}

function isImagePath(filePath) {
  return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isAudioPath(filePath) {
  return AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function normalizeAttachmentType(type) {
  if (type === "voice") {
    return "audio";
  }

  return type || "";
}

function describeAttachmentType(type) {
  if (type === "audio") {
    return "audio";
  }

  return type === "image" ? "image" : "file";
}

function inferSdkUploadFileType(attachment) {
  const ext = path.extname(attachment.absPath || attachment.name || "").toLowerCase();

  if (attachment.type === "audio") {
    const audioTypeMap = new Map([
      [".opus", "opus"],
      [".ogg", "opus"],
      [".mp3", "mp3"],
      [".wav", "wav"],
      [".aac", "aac"],
      [".m4a", "m4a"],
      [".amr", "amr"],
      [".flac", "flac"]
    ]);

    return audioTypeMap.get(ext) || "opus";
  }

  return "stream";
}

function normalizeRelativePath(filePath, root) {
  const resolved = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(root, filePath);
  return path.normalize(resolved);
}

function isWithinRoot(filePath, root) {
  const relative = path.relative(root, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function extractIncomingAttachment(message) {
  if (!message?.message_type || !message?.content) {
    return null;
  }

  let content = {};
  try {
    content = JSON.parse(message.content);
  } catch {
    return null;
  }

  if (message.message_type === "image" && typeof content.image_key === "string") {
    return {
      type: "image",
      fileKey: content.image_key,
      originalName: ""
    };
  }

  if (message.message_type === "file" && typeof content.file_key === "string") {
    return {
      type: "file",
      fileKey: content.file_key,
      originalName:
        (typeof content.file_name === "string" && content.file_name) ||
        (typeof content.fileName === "string" && content.fileName) ||
        ""
    };
  }

  if (message.message_type === "audio" && typeof content.file_key === "string") {
    return {
      type: "audio",
      fileKey: content.file_key,
      originalName: "",
      durationMs: typeof content.duration === "number" ? content.duration : 0
    };
  }

  return null;
}

export async function downloadIncomingAttachment({ client, attachment, messageId, outputDir }) {
  const response = await client.im.v1.messageResource.get({
    path: {
      message_id: messageId,
      file_key: attachment.fileKey
    },
    params: {
      type: attachment.type
    }
  });

  await fsp.mkdir(outputDir, { recursive: true });

  const headerFileName = inferFileNameFromHeaders(response.headers);
  const contentType = getHeader(response.headers, "content-type");
  const fallbackBase =
    attachment.type === "image"
      ? `image-${attachment.fileKey}`
      : attachment.type === "audio"
        ? `audio-${attachment.fileKey}`
        : `file-${attachment.fileKey}`;
  const safeName = ensureExtension(
    sanitizeFileName(attachment.originalName || headerFileName, fallbackBase),
    contentType,
    attachment.type === "image" ? ".png" : attachment.type === "audio" ? ".opus" : ""
  );
  const savedPath = path.join(outputDir, safeName);

  await response.writeFile(savedPath);

  return {
    type: attachment.type,
    fileKey: attachment.fileKey,
    originalName: attachment.originalName || headerFileName || safeName,
    savedPath,
    contentType,
    durationMs: attachment.durationMs || 0,
    receivedAt: Date.now(),
    messageId
  };
}

export function createSessionAttachmentStore({ maxItems = 5, ttlMs = 60 * 60 * 1000 } = {}) {
  const store = new Map();

  const prune = (sessionKey) => {
    const now = Date.now();
    const keys = sessionKey ? [sessionKey] : [...store.keys()];

    for (const key of keys) {
      const items = (store.get(key) || []).filter((item) => now - item.receivedAt <= ttlMs);
      if (!items.length) {
        store.delete(key);
        continue;
      }

      store.set(key, items.slice(-maxItems));
    }
  };

  return {
    add(sessionKey, attachment) {
      prune(sessionKey);
      const next = [...(store.get(sessionKey) || []), attachment].slice(-maxItems);
      store.set(sessionKey, next);
    },

    list(sessionKey) {
      prune(sessionKey);
      return [...(store.get(sessionKey) || [])];
    },

    clear(sessionKey) {
      store.delete(sessionKey);
    },

    pruneAll() {
      prune();
    }
  };
}

export function buildFeishuAttachmentPromptContext(attachments = []) {
  const sections = [
    "Feishu attachment reply protocol:",
    `- If you want the bridge to send local files back to Feishu, append a fenced block with info string \`${FEISHU_ATTACHMENTS_BLOCK}\` after the user-visible reply.`,
    "- Inside that block, put one attachment per line using `image <path>`, `audio <path>`, or `file <path>`.",
    "- Only reference real local files that already exist on disk and are safe to share back to the requester.",
    `- Example:\n\`\`\`${FEISHU_ATTACHMENTS_BLOCK}\naudio runs/reply.opus\nimage runs/chart.png\nfile runs/report.pdf\n\`\`\``
  ];

  if (attachments.length) {
    sections.push(
      "",
      "Recent Feishu attachments in this chat:",
      ...attachments.map((attachment) => {
        const label = describeAttachmentType(attachment.type);
        const name = attachment.originalName || path.basename(attachment.savedPath);
        const durationNote =
          attachment.type === "audio" && attachment.durationMs
            ? ` (${Math.max(1, Math.round(attachment.durationMs / 1000))}s)`
            : "";
        return `- ${label}: ${name}${durationNote} -> ${attachment.savedPath}`;
      }),
      "- Use these local paths directly when the user asks about the uploaded attachments."
    );
  }

  return sections.join("\n");
}

export function extractReplyAttachments(text) {
  const pattern = new RegExp(String.raw`[\r\n]*\`\`\`${FEISHU_ATTACHMENTS_BLOCK}\s*([\s\S]*?)\`\`\`\s*`, "g");
  const attachments = [];
  let cleanedText = text || "";

  cleanedText = cleanedText.replace(pattern, (_, blockBody) => {
    const lines = String(blockBody || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !line.startsWith("#"));

    for (const line of lines) {
      const typedMatch = line.match(/^(image|audio|voice|file)\s+(.+)$/i);
      if (typedMatch) {
        attachments.push({
          type: normalizeAttachmentType(typedMatch[1].toLowerCase()),
          path: typedMatch[2].trim()
        });
        continue;
      }

      attachments.push({
        type: "",
        path: line
      });
    }

    return "\n";
  });

  return {
    cleanedText: cleanedText.replace(/\n{3,}/g, "\n\n").trim(),
    attachments
  };
}

export function resolveReplyAttachments(rawAttachments, config) {
  const allowedRoots = [
    config.codex.workdir,
    config.runtime.logDir,
    config.runtime.stateDir,
    ...(config.codex.addDirs || [])
  ].map((item) => path.resolve(item));

  return rawAttachments.map((attachment) => {
    const resolvedPath = normalizeRelativePath(attachment.path, config.codex.workdir);
    const isAllowed = allowedRoots.some((root) => isWithinRoot(resolvedPath, root));

    if (!isAllowed) {
      throw new Error(`Attachment path is outside allowed roots: ${resolvedPath}`);
    }

    const stats = fs.statSync(resolvedPath);
    if (!stats.isFile()) {
      throw new Error(`Attachment path is not a file: ${resolvedPath}`);
    }

    const explicitType = normalizeAttachmentType(attachment.type);
    const type = explicitType || (isImagePath(resolvedPath) ? "image" : isAudioPath(resolvedPath) ? "audio" : "file");
    const maxBytes = type === "image" ? 10 * 1024 * 1024 : 30 * 1024 * 1024;
    if (stats.size > maxBytes) {
      throw new Error(`Attachment exceeds Feishu upload limit for ${type}: ${resolvedPath}`);
    }

    return {
      type,
      absPath: resolvedPath,
      name: path.basename(resolvedPath),
      size: stats.size
    };
  });
}

function runFeishuCliReply(args, cwd, config) {
  const invocation = buildFeishuCliSpawn(args, {
    cliBin: config?.feishu?.cliBin,
    fallbackIdentity: config?.feishu?.cliIdentity
  });

  return new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd,
      env: process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stderr = "";
    let stdout = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(`Feishu CLI attachment send failed (${code}): ${stderr || stdout}`));
    });
  });
}

async function prepareAttachmentPathForCli(attachment, config) {
  const workdir = path.resolve(config.codex.workdir);
  const relativeToWorkdir = path.relative(workdir, attachment.absPath);

  if (relativeToWorkdir && !relativeToWorkdir.startsWith("..") && !path.isAbsolute(relativeToWorkdir)) {
    return relativeToWorkdir;
  }

  const relayDir = path.join(config.runtime.stateDir, "feishu-outgoing");
  await fsp.mkdir(relayDir, { recursive: true });

  const relayName = `${Date.now()}-${sanitizeFileName(attachment.name, "attachment")}`;
  const relayPath = path.join(relayDir, relayName);
  await fsp.copyFile(attachment.absPath, relayPath);

  return path.relative(workdir, relayPath);
}

async function sendReplyAttachmentViaSdk({ client, messageId, attachment }) {
  if (attachment.type === "image") {
    const uploadedImage = await client.im.v1.image.create({
      data: {
        image_type: "message",
        image: fs.createReadStream(attachment.absPath)
      }
    });

    const imageKey = uploadedImage?.data?.image_key || uploadedImage?.image_key;
    if (!imageKey) {
      throw new Error(`Image upload did not return image_key for ${attachment.name}`);
    }

    await client.im.v1.message.reply({
      path: {
        message_id: messageId
      },
      data: {
        msg_type: "image",
        content: JSON.stringify({ image_key: imageKey })
      }
    });
    return;
  }

  const uploadedFile = await client.im.v1.file.create({
    data: {
      file_type: inferSdkUploadFileType(attachment),
      file_name: attachment.name,
      file: fs.createReadStream(attachment.absPath)
    }
  });

  const fileKey = uploadedFile?.data?.file_key || uploadedFile?.file_key;
  if (!fileKey) {
    throw new Error(`File upload did not return file_key for ${attachment.name}`);
  }

  await client.im.v1.message.reply({
    path: {
      message_id: messageId
    },
    data: {
      msg_type: attachment.type === "audio" ? "audio" : "file",
      content: JSON.stringify({ file_key: fileKey })
    }
  });
}

async function sendReplyAttachmentViaCli({
  messageId,
  attachment,
  config,
  cliReplyRunner,
  cliPathPreparer
}) {
  const flag = attachment.type === "image" ? "--image" : attachment.type === "audio" ? "--audio" : "--file";
  const cliPath = await cliPathPreparer(attachment, config);
  await cliReplyRunner(
    ["im", "+messages-reply", "--message-id", messageId, flag, cliPath],
    config.codex.workdir,
    config
  );
}

export async function sendReplyAttachments({ messageId, attachments, config, client, helpers = {} }) {
  const cliReplyRunner = helpers.runFeishuCliReply || runFeishuCliReply;
  const cliPathPreparer = helpers.prepareAttachmentPathForCli || prepareAttachmentPathForCli;
  const preferCli = config?.feishu?.preferCli !== false;
  const canUseCli = Boolean(config?.codex?.workdir);
  const canUseSdk = Boolean(client?.im?.v1?.message?.reply);

  for (const attachment of attachments) {
    if (preferCli && canUseCli) {
      try {
        await sendReplyAttachmentViaCli({
          messageId,
          attachment,
          config,
          cliReplyRunner,
          cliPathPreparer
        });
        continue;
      } catch (error) {
        if (!canUseSdk) {
          throw error;
        }
      }
    }

    if (canUseSdk) {
      await sendReplyAttachmentViaSdk({
        client,
        messageId,
        attachment
      });
      continue;
    }

    if (canUseCli) {
      await sendReplyAttachmentViaCli({
        messageId,
        attachment,
        config,
        cliReplyRunner,
        cliPathPreparer
      });
      continue;
    }

    throw new Error("No Feishu attachment delivery path is available.");
  }
}

export function buildAttachmentReceivedText({ chatType, attachment, commandPrefix }) {
  const kind = attachment.type === "audio" ? "voice message" : describeAttachmentType(attachment.type);
  const name = attachment.originalName || path.basename(attachment.savedPath);
  const durationNote =
    attachment.type === "audio" && attachment.durationMs
      ? ` (${Math.max(1, Math.round(attachment.durationMs / 1000))}s)`
      : "";

  if (chatType === "p2p") {
    return `Received the ${kind} \`${name}\`${durationNote}. Your next instruction in this chat will include it automatically.`;
  }

  return `Received the ${kind} \`${name}\`${durationNote}. Send \`${commandPrefix} <instruction>\` in this chat to use it.`;
}
