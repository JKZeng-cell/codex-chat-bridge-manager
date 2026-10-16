import "dotenv/config";

import { loadManagerConfig } from "./config.js";
import { createManagerServer } from "./managerServer.js";

const config = loadManagerConfig();
const server = createManagerServer(config);

await server.start();

console.log("Codex Chat Bridge Manager is running (third-party project)");
console.log(`Open http://${config.manager.host}:${config.manager.port}`);

const shutdown = async () => {
  await server.stop();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});
