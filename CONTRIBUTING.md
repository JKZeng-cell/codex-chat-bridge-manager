# Contributing / 参与贡献

Use Node.js 22.12+ (24 LTS recommended), then run:

```sh
npm ci
npm test
npm run check:release
npm audit --omit=dev
```

Keep changes focused and add regression tests. Never commit `.env`, `state/`,
`runs/`, credentials, private screenshots, or conversation exports. Screenshots
must use fictional data and be labeled as demonstrations. Test new authorization
flows with your own accounts and clearly report untested devices/platforms.

请保持改动聚焦，并为修复增加回归测试。界面延续现有黑白灰主题、键盘焦点与窄屏布局。
不要提交本机配置、授权资料或真实会话。说明实际验证范围，不把模拟测试写成真实扫码成功。

Platform SDK and CLI changes must preserve cancellation, timeouts, isolated bot
state, queue safety, credential masking, and sandbox defaults.
