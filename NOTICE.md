# Third-Party Notices / 第三方声明

This is an independent third-party project. It is not an official OpenAI,
Feishu/Lark, Tencent, or DingTalk product and is not endorsed by these companies.
本项目为独立第三方工具，非上述公司的官方产品，亦未获得其背书。

The MIT license applies to original project code, not third-party brand assets.
All trademarks and artwork remain the property of their respective owners.
官方标志仅用于辨识所连接的平台，相关权利归各品牌所有，不适用本项目 MIT 授权。

| Asset | Original source |
| --- | --- |
| Codex / OpenAI mark | [OpenAI developer site](https://developers.openai.com/codex/) |
| Feishu mark | [Feishu official CDN](https://lf-package-cn.feishucdn.com/obj/feishu-static/lark/open/website/favicon-logo.svg) |
| WeCom mark | [WeCom official CDN](https://wwcdn.weixin.qq.com/node/wwnl/wwnl/style/images/independent/favicon/favicon_48h$c976bd14.png) |
| WeChat mark | [WeChat official CDN](https://res.wx.qq.com/a/wx_fed/assets/res/NTI4MWU5.ico) |
| DingTalk mark | [DingTalk official CDN](https://gw.alicdn.com/imgextra/i3/O1CN014ZbI6ZTEhdC0ttN2_!!6000000003783-2-tps-444-444.png) |

The unchanged platform images are embedded in `src/public/platform-icons.js`.
The OpenAI mark is in `src/public/codex-mark.js`; the connection badge is original
project artwork, not an official product logo.

The interface optionally fetches OpenAI Sans from the official
`cdn.openai.com/common/fonts/openai-sans/v2/` font CDN and falls back to installed
fonts if unavailable. No font files are redistributed. The UI is inspired by
Codex, not a pixel-identical copy. 可选字体请求会访问 OpenAI CDN；断网时使用本机字体。

Dependencies retain their own licenses. Inspect their package LICENSE files and
`package-lock.json` before redistribution.

Windows desktop distributions bundle Electron (MIT and Chromium third-party
notices included in the application directory), Codex CLI (Apache-2.0), and
Feishu CLI (MIT), WeCom CLI and its official skills (MIT), and DingTalk Workspace
CLI and its official skills (Apache-2.0). Runtime tool licenses are included under
`resources/tools/`. Pinned artifact sources, integrity values, and skill commits
are recorded in `build/platform-tools.lock.json`; the packaged inventory is
`resources/tools/platform-tools.json`. CLI authorization remains a separate
user-approved step and no platform credentials are bundled.
Bundled Codex vendor resources retain their accompanying third-party notices.
