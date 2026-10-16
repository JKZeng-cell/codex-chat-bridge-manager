# Validation / 验证范围

## v1.0.1 Avatar Update / 头像更新

Verified on 2026-10-16, Windows, Node.js 24.11.1:

- 104 automated tests pass, including five avatar tests covering all 16 local
  designs, safe fallback IDs, independent per-bot persistence, corrupted values,
  and blocked browser storage.
- Browser verification confirmed persistence after reload, independent choices
  for two fictional bots, synchronized conversation avatars, retained official
  platform badges, Escape dismissal, and restored keyboard focus.
- Avatar dialog fits widths 390, 780, 1280, and 1920; light and dark screenshots
  were visually inspected. No page JavaScript errors occurred in these checks.
- Avatar settings only affect this browser's local management UI. No platform
  profile, credentials, bot configuration, or live service was modified.

头像更新沿用现有视觉规范，无需重启服务。公开截图使用虚拟机器人与演示数据。

## v1.0.0 Local Gate / 首版本机验证

Release preparation on 2026-10-16, Windows, Node.js 24.11.1:

- 99 automated tests pass. Coverage includes binding cancellation/expiry,
  credential masking, per-chat queues, configuration reloads, maintenance
  verification, attachments/cards, model parsing, safe Markdown, and appearance.
- Dependency audit after compatible updates: zero known vulnerabilities at the
  time checked. Advisory databases change; rerun `npm audit` before deployment.
- Browser checks at widths 390, 780, 1280, and 1920 for Conversations,
  Connections, Skills, and System: no page-level horizontal overflow.
- Binding picker stays within the viewport; connection cards open settings and
  return correctly; dark appearance survives reload; no page JavaScript errors
  during the demo checks. Three screenshots were visually inspected.
- Request tests reject foreign Host headers, cross-origin writes, and JSON
  bodies over 1 MiB. Public CLI status omits private device codes.
- Fresh `npm ci` in an isolated source copy succeeded, followed by 99 passing
  tests and an empty-manager smoke test: no inherited bot credentials, working
  overview API, and all six checked frontend resources returned HTTP 200.
  The installed Codex binary reported version 0.163.0.
- Existing local service remained online. Restart was blocked by the execution
  environment; backend source changes were verified in isolation rather than
  claimed as active in the previously running process.

本机测试与浏览器检查使用隔离目录/虚拟数据，不修改真实机器人设置或用户会话。
公开截图不含真实账号、授权资料或消息。

## Reproduce / 复现

```sh
npm ci
npm test
npm run check:release
npm audit --omit=dev
```

The GitHub workflow repeats tests, release checks, and audit on Windows and
Ubuntu, Node.js 22 and 24. Consult the actual Actions run for current results;
the presence of a workflow file alone is not evidence that CI passed.

## Not Claimed / 未声称覆盖

- Live phone authorization and real message delivery on all four platforms.
- Real global CLI/skill upgrades on the user's installation during this release.
- Full accessibility certification, pixel-identical Codex parity, or browser
  coverage beyond the Chromium-based browser used locally.
- External platform uptime, all tenant permission combinations, or availability
  of every model listed by a user's local Codex cache.

四个平台的网络协议与消息适配通过模拟响应测试；真实扫码需用户手机与平台权限，
不应将模拟测试误认为平台端到端验收。安全检查不是完整安全审计，管理界面仅用于本机。
