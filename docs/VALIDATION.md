# Validation / 验证范围

## v1.0.1 Avatar Update / 头像更新

### Desktop And UI / 桌面与界面

- 107 automated tests pass after adding desktop path/navigation policy and native
  CLI spawning tests. Full production and development dependency audit reports
  zero known vulnerabilities at preparation time.
- The integrated square brand icon, icon-only sidebar controls, top-aligned
  System panels, and refined avatar paths were visually checked with fictional
  data. Widths 390, 780, 1280, and 1920 showed no page-level horizontal overflow.
- Windows x64 builds bundle Electron 44.8.0, Codex CLI 0.163.0, and Feishu CLI
  1.0.98. The Electron archive was verified against its package SHA-256 checksum.
- The packaged application started in an isolated profile, loaded the System
  page, exposed no renderer Node integration, had zero inherited bots, and ran
  both bundled CLI binaries successfully. Exit code was zero.
- Archive inspection verified required source/runtime files and no root `.env`,
  `state/`, `runs/`, or `pet-runs/` directories in the application package.
- The self-extracting portable executable also passed the same isolated startup,
  bundled-tool, renderer-isolation, and clean-exit checks. This test used an
  E-drive temporary directory because the system drive had insufficient free
  space; desktop extraction is documented to require 2 GB of available space.
- The NSIS installer completed silently into an isolated E-drive directory;
  the installed application passed the same startup and bundled-tool checks.
  The isolated installation was then uninstalled without touching web-manager
  state or the user's existing authorization directories.
- Windows executables are unsigned (`NotSigned`). A working application package
  is not code-signing certification or proof of all-platform live authorization.

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
