#!/usr/bin/env node
import "dotenv/config";
import { spawn } from "node:child_process";

import { buildFeishuCliSpawn } from "../src/feishuCli.js";

const invocation = buildFeishuCliSpawn(process.argv.slice(2));

const child = spawn(invocation.command, invocation.args, {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
  windowsHide: true
});

child.on("error", (error) => {
  console.error(`Failed to start Feishu CLI wrapper: ${error.message}`);
  process.exit(1);
});

child.on("close", (code) => {
  process.exit(code ?? 1);
});
