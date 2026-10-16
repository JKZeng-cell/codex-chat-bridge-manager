import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  FEISHU_ATTACHMENTS_BLOCK,
  buildFeishuAttachmentPromptContext,
  createSessionAttachmentStore,
  downloadIncomingAttachment,
  extractIncomingAttachment,
  extractReplyAttachments,
  resolveReplyAttachments,
  sendReplyAttachments,
  sanitizeAttachmentStorageName
} from "../src/feishuAttachments.js";

test("extractIncomingAttachment reads image and file message payloads", () => {
  assert.deepEqual(
    extractIncomingAttachment({
      message_type: "image",
      content: JSON.stringify({
        image_key: "img_v3_123"
      })
    }),
    {
      type: "image",
      fileKey: "img_v3_123",
      originalName: ""
    }
  );

  assert.deepEqual(
    extractIncomingAttachment({
      message_type: "file",
      content: JSON.stringify({
        file_key: "file_v3_123",
        file_name: "report.pdf"
      })
    }),
    {
      type: "file",
      fileKey: "file_v3_123",
      originalName: "report.pdf"
    }
  );

  assert.deepEqual(
    extractIncomingAttachment({
      message_type: "audio",
      content: JSON.stringify({
        file_key: "file_v3_audio",
        duration: 4200
      })
    }),
    {
      type: "audio",
      fileKey: "file_v3_audio",
      originalName: "",
      durationMs: 4200
    }
  );
});

test("sanitizeAttachmentStorageName produces Windows-safe folder names", () => {
  assert.equal(sanitizeAttachmentStorageName("group:oc_123"), "group_oc_123");
  assert.equal(sanitizeAttachmentStorageName(""), "session");
});

test("createSessionAttachmentStore keeps recent items and prunes expired ones", async () => {
  const store = createSessionAttachmentStore({
    maxItems: 2,
    ttlMs: 20
  });

  store.add("chat:1", { savedPath: "a.txt", receivedAt: Date.now() - 100 });
  store.add("chat:1", { savedPath: "b.txt", receivedAt: Date.now() });
  store.add("chat:1", { savedPath: "c.txt", receivedAt: Date.now() });

  assert.deepEqual(
    store.list("chat:1").map((item) => item.savedPath),
    ["b.txt", "c.txt"]
  );

  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(store.list("chat:1"), []);
});

test("buildFeishuAttachmentPromptContext documents reply block and recent files", () => {
  const context = buildFeishuAttachmentPromptContext([
    {
      type: "image",
      originalName: "diagram.png",
      savedPath: "E:\\codex\\state\\feishu-attachments\\diagram.png"
    }
  ]);

  assert.match(context, new RegExp(FEISHU_ATTACHMENTS_BLOCK));
  assert.match(context, /image <path>/);
  assert.match(context, /audio <path>/);
  assert.match(context, /diagram\.png/);
});

test("extractReplyAttachments removes the control block from reply text", () => {
  const parsed = extractReplyAttachments(
    "Done.\n\n```feishu_attachments\naudio runs/reply.opus\nimage runs/chart.png\nvoice runs/legacy.wav\nfile runs/report.pdf\n```"
  );

  assert.equal(parsed.cleanedText, "Done.");
  assert.deepEqual(parsed.attachments, [
    { type: "audio", path: "runs/reply.opus" },
    { type: "image", path: "runs/chart.png" },
    { type: "audio", path: "runs/legacy.wav" },
    { type: "file", path: "runs/report.pdf" }
  ]);
});

test("resolveReplyAttachments validates roots, infers types, and enforces file existence", async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "codex-feishu-attachments-"));
  const imagePath = path.join(tempDir, "chart.png");
  const audioPath = path.join(tempDir, "reply.opus");
  const reportPath = path.join(tempDir, "report.pdf");
  await fsp.writeFile(imagePath, "image-bytes");
  await fsp.writeFile(audioPath, "audio-bytes");
  await fsp.writeFile(reportPath, "pdf-bytes");

  const config = {
    codex: {
      workdir: tempDir,
      addDirs: []
    },
    runtime: {
      logDir: tempDir,
      stateDir: tempDir
    }
  };

  const resolved = resolveReplyAttachments(
    [
      { type: "", path: "chart.png" },
      { type: "", path: audioPath },
      { type: "file", path: reportPath }
    ],
    config
  );

  assert.equal(resolved[0].type, "image");
  assert.equal(resolved[0].absPath, imagePath);
  assert.equal(resolved[1].type, "audio");
  assert.equal(resolved[1].absPath, audioPath);
  assert.equal(resolved[2].type, "file");
  assert.equal(resolved[2].absPath, reportPath);

  await assert.rejects(
    async () =>
      resolveReplyAttachments(
        [
          {
            type: "file",
            path: path.join(os.tmpdir(), "outside.txt")
          }
        ],
        config
      ),
    /outside allowed roots/
  );
});

test("downloadIncomingAttachment writes the resource to disk using SDK response helpers", async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "codex-feishu-download-"));
  const client = {
    im: {
      v1: {
        messageResource: {
          async get(request) {
            assert.deepEqual(request.path, {
              message_id: "om_123",
              file_key: "file_v3_123"
            });
            assert.deepEqual(request.params, {
              type: "file"
            });

            return {
              headers: {
                "content-disposition": 'attachment; filename="report.txt"',
                "content-type": "text/plain"
              },
              async writeFile(targetPath) {
                await fsp.writeFile(targetPath, "hello world");
              }
            };
          }
        }
      }
    }
  };

  const downloaded = await downloadIncomingAttachment({
    client,
    attachment: {
      type: "file",
      fileKey: "file_v3_123",
      originalName: ""
    },
    messageId: "om_123",
    outputDir: tempDir
  });

  assert.equal(downloaded.originalName, "report.txt");
  assert.equal(path.basename(downloaded.savedPath), "report.txt");
  assert.equal(fs.readFileSync(downloaded.savedPath, "utf8"), "hello world");
});

test("sendReplyAttachments prefers CLI replies for files when enabled", async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "codex-feishu-send-"));
  const filePath = path.join(tempDir, "report.xlsx");
  await fsp.writeFile(filePath, "sheet-bytes");

  const cliCalls = [];
  const sdkCalls = [];

  await sendReplyAttachments({
    messageId: "om_123",
    attachments: [
      {
        type: "file",
        absPath: filePath,
        name: "report.xlsx",
        size: 11
      }
    ],
    config: {
      feishu: { preferCli: true },
      codex: { workdir: tempDir },
      runtime: { stateDir: tempDir }
    },
    client: {
      im: {
        v1: {
          file: {
            async create() {
              sdkCalls.push("file.create");
              return { file_key: "file_v3_123" };
            }
          },
          message: {
            async reply() {
              sdkCalls.push("message.reply");
              return { code: 0 };
            }
          }
        }
      }
    },
    helpers: {
      async prepareAttachmentPathForCli() {
        return "runs/report.xlsx";
      },
      async runFeishuCliReply(args, cwd) {
        cliCalls.push({ args, cwd });
      }
    }
  });

  assert.deepEqual(cliCalls, [
    {
      args: ["im", "+messages-reply", "--message-id", "om_123", "--file", "runs/report.xlsx"],
      cwd: tempDir
    }
  ]);
  assert.deepEqual(sdkCalls, []);
});

test("sendReplyAttachments falls back to SDK when CLI delivery fails", async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "codex-feishu-audio-send-"));
  const audioPath = path.join(tempDir, "reply.opus");
  await fsp.writeFile(audioPath, "audio-bytes");

  const calls = [];
  await sendReplyAttachments({
    messageId: "om_audio_123",
    attachments: [
      {
        type: "audio",
        absPath: audioPath,
        name: "reply.opus",
        size: 11
      }
    ],
    config: {
      feishu: { preferCli: true },
      codex: { workdir: tempDir },
      runtime: { stateDir: tempDir }
    },
    client: {
      im: {
        v1: {
          file: {
            async create(payload) {
              calls.push({
                type: "file.create",
                file_type: payload.data.file_type,
                file_name: payload.data.file_name
              });
              return { file_key: "file_v3_audio" };
            }
          },
          message: {
            async reply(payload) {
              calls.push({
                type: "message.reply",
                message_id: payload.path.message_id,
                msg_type: payload.data.msg_type,
                content: payload.data.content
              });
              return { code: 0 };
            }
          }
        }
      }
    },
    helpers: {
      async prepareAttachmentPathForCli() {
        return "runs/reply.opus";
      },
      async runFeishuCliReply() {
        throw new Error("cli unavailable");
      }
    }
  });

  assert.deepEqual(calls, [
    {
      type: "file.create",
      file_type: "opus",
      file_name: "reply.opus"
    },
    {
      type: "message.reply",
      message_id: "om_audio_123",
      msg_type: "audio",
      content: JSON.stringify({ file_key: "file_v3_audio" })
    }
  ]);
});
