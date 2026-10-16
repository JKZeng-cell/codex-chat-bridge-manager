export const PLATFORMS = {
  feishu: { name: "飞书", hint: "扫码创建独立机器人，现有应用也可手动接入" },
  wecom: { name: "企业微信", hint: "使用企业微信扫码，授权智能机器人" },
  weixin: { name: "微信", hint: "使用微信扫码，绑定微信机器人" },
  dingtalk: { name: "钉钉", hint: "使用钉钉扫码，创建并授权机器人" }
};

export function assertPlatform(platform) {
  if (!Object.hasOwn(PLATFORMS, platform)) throw new Error("不支持的机器人平台");
  return platform;
}

export function trustedWeixinBase(value = "https://ilinkai.weixin.qq.com") {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !(url.hostname === "weixin.qq.com" || url.hostname.endsWith(".weixin.qq.com"))) {
    throw new Error("微信服务地址不可信，请重新扫码绑定");
  }
  return url.origin;
}

export async function requestJson(url, options = {}, fetcher = fetch) {
  const response = await fetcher(url, {
    ...options, redirect: "error", signal: options.signal || AbortSignal.timeout(35000),
    headers: { "Content-Type": "application/json", ...options.headers }
  });
  if (!response.ok) throw new Error(`平台请求失败 (${response.status})`);
  const value = await response.json();
  if ((value.errcode != null && Number(value.errcode) !== 0) ||
      (value.ret != null && Number(value.ret) !== 0)) {
    throw new Error(`平台接口错误 ${value.errcode ?? value.ret}，请检查授权或重试`);
  }
  return value;
}

export const weixinHeaders = () => ({
  "iLink-App-Id": "bot", "iLink-App-ClientVersion": String((2 << 16) | (4 << 8) | 6),
  AuthorizationType: "ilink_bot_token",
  "X-WECHAT-UIN": Buffer.from(String(Math.floor(Math.random() * 0xffffffff))).toString("base64")
});
