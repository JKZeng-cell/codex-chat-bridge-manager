import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import crypto from "node:crypto";

import { cleanCodexCliNoise } from "./utils.js";
import { PLATFORM_CLIS, platformCliDirectory, platformCliEnvironment, resolvePlatformCli } from "./platformCli.js";

function makeRunId(messageId) {
  const safeMessageId = messageId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-${safeMessageId}-${crypto
    .randomBytes(3)
    .toString("hex")}`;
}

function buildCommand(config, outputPath, prompt, resumeSessionId) {
  const args = [];
  if (config.codex.cliMode === "local") {
    args.push(config.codex.localCliPath);
  } else if (config.codex.cliMode === "global") {
    // No-op: global mode uses the codex executable directly.
  } else {
    args.push("-y", config.codex.cliPackage);
  }

  args.push("-C", config.codex.workdir);

  if (config.codex.model) {
    args.push("--model", config.codex.model);
  }

  if (config.codex.sandbox) {
    args.push("--sandbox", config.codex.sandbox);
  }

  for (const dir of config.codex.addDirs) {
    args.push("--add-dir", dir);
  }

  args.push("exec");

  if (resumeSessionId) {
    args.push("resume");
  }

  args.push("--json");

  if (!resumeSessionId) {
    args.push("--color", "never");
  }

  args.push("--output-last-message", outputPath);

  if (config.codex.skipGitRepoCheck) {
    args.push("--skip-git-repo-check");
  }

  if (config.codex.ephemeral) {
    args.push("--ephemeral");
  }

  if (resumeSessionId) {
    args.push(resumeSessionId);
  }

  args.push(...config.codex.extraArgs, prompt);

  return {
    command: config.codex.cliBin,
    args
  };
}

export class CodexRunError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "CodexRunError";
    this.details = details;
  }
}

export function createCodexRunner(config) {
  return {
    async run({ prompt, messageId, onEvent, onStderr, resumeSessionId }) {
      await fsp.mkdir(config.runtime.logDir, { recursive: true });
      if (config.bot?.platformCliEnabled && PLATFORM_CLIS[config.bot.platform]) await fsp.mkdir(platformCliDirectory(config, config.bot), { recursive: true });

      const runId = makeRunId(messageId);
      const outputPath = path.join(config.runtime.logDir, `${runId}.message.txt`);
      const transcriptPath = path.join(config.runtime.logDir, `${runId}.transcript.log`);
      const metadataPath = path.join(config.runtime.logDir, `${runId}.metadata.json`);

      const { command, args } = buildCommand(config, outputPath, prompt, resumeSessionId);
      const transcriptStream = fs.createWriteStream(transcriptPath, { flags: "a" });
      const startedAt = Date.now();
      let stderrTail = "";
      let stdoutTail = "";
      let stdoutBuffer = "";
      let threadId = resumeSessionId || "";

      const platform = config.bot?.platform;
      const env = PLATFORM_CLIS[platform] ? platformCliEnvironment(config, config.bot, process.env,
        config.bot.platformCliEnabled ? resolvePlatformCli(platform, config.platformClis?.[platform]) : "") : process.env;
      const child = spawn(command, args, {
        cwd: config.codex.workdir,
        env,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      });

      const captureTail = (current, chunk) => {
        const combined = `${current}${chunk.toString("utf8")}`;
        return combined.length > 8000 ? combined.slice(-8000) : combined;
      };

      child.stdout.on("data", (chunk) => {
        transcriptStream.write(chunk);
        stdoutTail = captureTail(stdoutTail, chunk);

        stdoutBuffer += chunk.toString("utf8");
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            continue;
          }

          try {
            const event = JSON.parse(trimmed);
            if (event?.type === "thread.started" && typeof event.thread_id === "string") {
              threadId = event.thread_id;
            }
            onEvent?.(event);
          } catch {
            // Keep non-JSON lines in the transcript only.
          }
        }
      });

      child.stderr.on("data", (chunk) => {
        transcriptStream.write(chunk);
        stderrTail = captureTail(stderrTail, chunk);
        onStderr?.(cleanCodexCliNoise(chunk.toString("utf8")));
      });

      const exitCode = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          child.kill();
          reject(
            new CodexRunError("Codex execution timed out", {
              outputPath,
              transcriptPath,
              metadataPath,
              stdoutTail,
              stderrTail
            })
          );
        }, config.codex.timeoutMs);

        child.on("error", (error) => {
          clearTimeout(timer);
          reject(
            new CodexRunError(`Failed to start Codex: ${error.message}`, {
              outputPath,
              transcriptPath,
              metadataPath,
              stdoutTail,
              stderrTail
            })
          );
        });

        child.on("close", (code) => {
          clearTimeout(timer);
          const finalLine = stdoutBuffer.trim();
          if (finalLine) {
            try {
              const event = JSON.parse(finalLine);
              if (event?.type === "thread.started" && typeof event.thread_id === "string") {
                threadId = event.thread_id;
              }
              onEvent?.(event);
            } catch {
              // Keep trailing non-JSON lines in the transcript only.
            }
          }
          resolve(code ?? 1);
        });
      }).finally(() => {
        transcriptStream.end();
      });

      const durationMs = Date.now() - startedAt;
      const message = await fsp.readFile(outputPath, "utf8").catch(() => "");

      const metadata = {
        runId,
        prompt,
        durationMs,
        exitCode,
        command,
        args,
        threadId,
        workdir: config.codex.workdir,
        outputPath,
        transcriptPath
      };
      await fsp.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

      if (exitCode !== 0 || !message.trim()) {
        throw new CodexRunError("Codex execution failed", {
          ...metadata,
          stdoutTail,
          stderrTail: cleanCodexCliNoise(stderrTail)
        });
      }

      return {
        ...metadata,
        message: message.trim()
      };
    }
  };
}
