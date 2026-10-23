import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { PLATFORM_CLIS, platformCliDirectory, platformCliEnvironment, platformCliVersion, resolvePlatformCli, supportsPlatformCli } from "../src/platformCli.js";
import { parseCliAuthorization, safeCliAuthorizationUrl } from "../src/platformCliManager.js";

test("CLI resolution uses native npm binaries on Windows rather than a shell shim", () => {
  const root = path.join(path.parse(process.cwd()).root, "profile", "Roaming");
  const expected = path.join(root, "npm", "node_modules", "@wecom", "cli", "node_modules", "@wecom/cli-win32-x64", "bin", "wecom-cli.exe");
  assert.equal(resolvePlatformCli("wecom", { platform: "win32", arch: "x64", env: { APPDATA: root }, exists: (file) => file === expected }), expected);
  const ding = path.join(root, "npm", "node_modules", "dingtalk-workspace-cli", "vendor", "dws.exe");
  assert.equal(resolvePlatformCli("dingtalk", { platform: "win32", env: { APPDATA: root }, exists: (file) => file === ding }), ding);
  assert.throws(() => resolvePlatformCli("wecom", { bin: "wecom-cli.cmd" }), /原生/);
  assert.throws(() => resolvePlatformCli("weixin"), /不支持/);
});

test("platform authorization environments isolate each bot and remove ambient credential overrides", () => {
  const config = { runtime: { botsStateDir: path.resolve("isolated-bots") } };
  const bot = { id: "team-one", platform: "wecom" };
  const env = platformCliEnvironment(config, bot, { PATH: "original", WECOM_CLI_ACCESS_TOKEN: "private", WECOM_CLI_ADDITIONAL_HEADERS_X: "private", DWS_CLIENT_SECRET: "private", DWS_CLIENT_ID: "private" });
  assert.equal(env.WECOM_CLI_CONFIG_DIR, platformCliDirectory(config, bot));
  assert.equal(JSON.stringify(env).includes("private"), false);
  assert.notEqual(env.WECOM_CLI_CONFIG_DIR, platformCliDirectory(config, { ...bot, id: "team-two" }));
  assert.throws(() => platformCliDirectory(config, { ...bot, id: "../escape" }), /不支持/);
});

test("CLI integration gates legacy versions without guessing authentication commands", () => {
  assert.equal(platformCliVersion("v1.0.65\n"), "1.0.65");
  assert.equal(platformCliVersion("wecom-cli 1.3.4 (release build)"), "1.3.4");
  assert.equal(supportsPlatformCli("wecom-cli 0.1.9", PLATFORM_CLIS.wecom.minimum), false);
  assert.equal(supportsPlatformCli("wecom-cli 1.2.1", PLATFORM_CLIS.wecom.minimum), true);
  assert.equal(supportsPlatformCli("dws 1.0.65-beta.1", PLATFORM_CLIS.dingtalk.minimum), false);
  assert.equal(supportsPlatformCli("dws 1.0.65", PLATFORM_CLIS.dingtalk.minimum), true);
});

test("authorization state parsing never equates successful exit with authorized", () => {
  assert.equal(parseCliAuthorization("wecom", "unauthorized\n"), false);
  assert.equal(parseCliAuthorization("wecom", "authorized\n"), true);
  assert.equal(parseCliAuthorization("dingtalk", '{"authenticated":false}'), false);
  assert.equal(parseCliAuthorization("dingtalk", '{"authenticated":true,"token_valid":true}'), true);
  assert.throws(() => parseCliAuthorization("dingtalk", '{"authenticated":false,"reason":"local_state_unreadable"}'), /无法确认/);
  assert.throws(() => parseCliAuthorization("dingtalk", 'private-token-not-json'), (error) => !error.message.includes("private-token"));
  assert.throws(() => parseCliAuthorization("wecom", "unknown"), /无法识别|可识别/);
});

test("only official HTTPS login URLs are exposed, never device codes or arbitrary log links", () => {
  const url = "https://login.dingtalk.com/oauth2/device?user_code=public-user-code";
  assert.equal(safeCliAuthorizationUrl("private-device-code\n" + url + "\n", "dingtalk"), url);
  assert.equal(safeCliAuthorizationUrl("https://attacker.test/auth?token=private", "dingtalk"), "");
  assert.equal(safeCliAuthorizationUrl("https://login.dingtalk.com.attacker.test/auth", "dingtalk"), "");
  assert.equal(safeCliAuthorizationUrl("https://user:pass@login.dingtalk.com/auth", "dingtalk"), "");
  assert.equal(safeCliAuthorizationUrl("http://login.dingtalk.com/auth", "dingtalk"), "");
});
