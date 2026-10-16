import "dotenv/config";

import { createBridgeRuntime } from "./bridgeRuntime.js";
import { loadConfig } from "./config.js";

const runtime = createBridgeRuntime(loadConfig());

await runtime.start();

console.log("Codex Feishu bridge is running in single-bot mode");
console.log(`Workdir: ${runtime.config.codex.workdir}`);
console.log(`Command prefix: ${runtime.config.feishu.commandPrefix}`);

const shutdown = async () => {
  await runtime.stop();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});
