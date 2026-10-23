# Validation / 验证范围

## v1.0.7 Reply Delivery Repair / 回复投递修复

Verified locally on 2026-10-23, Windows x64:

- Diagnosis used the running installed 1.0.6 and its local records. A WeCom
  request contained a completed public answer and turn.completed in the Codex
  transcript but was marked failed after the ten-minute process timeout.
  DingTalk had generated answers without recorded transport failures; source
  inspection found missing card layout/order and INPUTING state, and ignored
  business rejection inside HTTP 200 responses. Mobile rendering was not
  directly inspected.
- All 184 automated tests passed. Native child-process fixtures cover completed
  turns with hung teardown, event-only final output, split UTF-8 buffers,
  incomplete/failed turns, normal/legacy exits, and delivery plus queue release
  through the platform runtime. No real Codex/model request was submitted by
  these fixtures.
- Mock platform tests cover DingTalk content order/layout, state transitions,
  private/group targets, HTTP 200 rejected delivery, terminal stream failure
  and text fallback; WeCom aging streams, update budgets, bounded SDK ack waits,
  proactive full-result/overflow delivery and rejected active messages.
- Receipt sends no longer block execution; quiet native streams receive public
  waiting feedback. Tests verify heartbeat cleanup, abort signals, terminal
  ordering, delivery-error visibility and no reasoning-text forwarding.
- The unpacked and Portable 1.0.7 applications passed isolated desktop smokes with zero
  inherited bots, working bundled tools, renderer isolation, tray hide/restore,
  continued background service and protected installer-quit IPC; exit code zero.
  Packaged application sources match the checkout, including new reply modules;
  no private runtime roots are present.
- The 1.0.7 Setup and Portable executables were generated. Setup SHA-256 is
  651ce504872bcdf86f5c63b14d077a125dbbc83e1a92a20b5c34ecfd0694c087.
  The automatic in-place install and later normal-launch commands were rejected
  before execution by the execution policy; no alternate execution route was
  used. After the user's manual installation and launch, the installed archive
  and executable verified as 1.0.7 and its running frontend matched the checkout.
- The existing three bots returned to running state. Two new user-sent live
  messages completed: DingTalk in 19,740 ms and WeCom in 28,735 ms. Both records
  have deliveryStatus=sent, terminalEvent=turn.completed, exitCode=0 and bounded
  post-completion cleanup, with empty queues and no transport errors. The user
  subsequently confirmed both the DingTalk card body and WeCom reply appeared
  correctly in their chat clients. This is user-confirmed live acceptance, not
  an agent-captured screenshot of the phone clients.
- The current-user Windows uninstall registry still displays 1.0.6 although the
  installed executable/archive and running code are 1.0.7; it was not manually
  rewritten. Desktop installers have not been published as GitHub Release assets
  for this build. Consult GitHub Actions for the current hosted CI results.

本机经用户手动安装和启动后已验证运行 1.0.7；旧的失败请求不会自动重发。
未修改全局 MCP 配置或真实机器人授权，未改写旧历史，未强制关闭本机服务。
安装包仍未代码签名。两端正文显示已由用户确认正常。

## v1.0.6 Local Installer Repair / 本机安装修复

Verified locally on 2026-10-23, Windows x64:

- All 168 automated tests passed. A compiled NSIS fixture exercised low-space
  relaunch to another volume, original parameters including a spaced /D path,
  staging cleanup, and early exit code 50 when neither location has enough space.
  This fixture is not a full low-space migration of a populated installation.
- ACL-denied and writable/new-directory cases verified the permission preflight:
  denied access returns 40 before app inspection or old-version removal. The
  one-off probe files are deleted without modifying installed files.
- PE manifests were inspected in the built and installed files: Setup and
  Uninstall request administrator permission; the application and Portable
  remain asInvoker. No global TEMP/TMP setting is changed by the installer.
- The verified Setup upgraded the real existing installation from 1.0.4 to
  1.0.6 in place with exit code zero. The uninstall registry reports 1.0.6.
  All five pre-existing configuration/authorization state files retained their
  SHA-256 values. No process was force-stopped.
- The installed archive matches the current application source and bundled
  tool/skill inventory. An isolated installed-app startup passed with zero
  inherited bots, 31 built-in platform skills, renderer isolation, tray hide,
  restore, continued service while hidden, and protected quit IPC; exit code zero.
  Real bot services were not automatically started for this check.
- Windows packages remain unsigned. These results verify the local repair;
  no GitHub publication or hosted CI result is claimed for 1.0.6 here.

## v1.0.5 Built-In Platform Tools / 内置平台工具

Verified locally on 2026-10-23, Windows x64:

- All 166 automated tests passed. Full and production dependency audits found
  zero known vulnerabilities. Coverage includes native/append reply ordering,
  acknowledgement failure, duplicate suppression, terminal delivery, UTF-8
  chunking, DingTalk card/text fallback, scoped CLI authorization, cancellation,
  expiry, readonly diagnostics, quick-enable form synchronization and artifact
  integrity/path checks.
- Official WeCom CLI 1.3.4 and DingTalk DWS 1.0.65 executed from application
  resources, together with 15 WeCom and 16 DingTalk official skills. Artifacts
  were verified against pinned registry/release digests. DWS license and NOTICE
  are included. No global CLI or user skill installation was performed.
- Fresh isolated CLI profiles reported WeCom unauthorized and DingTalk readonly
  initialization/repair required, not authenticated. The latter remains an
  actionable setup state rather than blocking the authorization button.
- A live unscanned WeCom QR was generated and polled twice through the fixed
  manager: waiting state and QR were retained, with zero saved bots. No phone
  confirmation, tenant grant, or real chat delivery was performed.
- Browser checks used fictional bot data and isolated profiles. Real bundled
  tool detection showed the correct versions/skill counts; simulated QR
  display/cancellation and saved CLI opt-in were exercised. Desktop 1568px and
  mobile 390px layouts had no document-width overflow. A favicon 404 was the
  only browser console error observed.
- Final unpacked and self-extracting portable 1.0.5 packages passed startup,
  bundled tools/skills, renderer isolation, system health, tray minimize/restore,
  close-keeps-service and protected installer-quit IPC checks. Profiles contained
  zero inherited bots. Packaged source matched the checkout byte-for-byte;
  tool and SKILL.md hashes matched the generated inventory; private runtime and
  promotional directories were absent.
- Installer/portable SHA-256 and updater SHA-512 metadata were verified. Windows
  executables remain unsigned (`NotSigned`). Automatic in-place installation
  was blocked by the execution policy, so a successful upgrade of the existing
  desktop installation is not claimed for this version.

协议、CLI 与 GUI 模拟测试不等于所有平台均已完成手机授权、企业权限审批与真实消息投递验收。
微信为完成段落分段发送，不是原位逐字编辑；实际增量频率取决于 Codex 输出事件。
钉钉流式卡片仍需要平台权限，不绕过企业策略。

## v1.0.4 System Tray / 托盘后台运行

Verified locally on 2026-10-23, Windows x64:

- All 128 automated tests passed, including tray hide/restore, explicit quit,
  unavailable-tray fallback, legacy window close and tray-aware installer IPC.
  The production dependency audit reported zero known vulnerabilities.
- Development, unpacked, portable and installed desktop checks exercised actual
  window minimize, close-to-tray, restoration and an HTTP request while hidden.
  All kept the local service alive and exited cleanly via the dedicated
  single-instance installer-quit request.
- A native tray-app fixture ignores window close and protects a simulated busy
  job; the installer helper correctly requests quit IPC, waits while busy and
  completes after the fixture becomes idle. This does not certify live robot
  jobs on all platforms.
- The Windows installer upgraded this computer from 1.0.3 to 1.0.4 in the existing
  application directory with exit code zero. Installed archive checks matched
  the build and found the tray module, ICO resource and required bundled tools.
  No bridge processes remained after the installed isolated check.
- Startup checks used separate empty profiles with zero bots; they did not
  import existing platform credentials. No existing desktop state files were
  present in the pre-upgrade snapshot, so populated-state migration is not
  claimed. The application shortcut resolves to the upgraded executable.
- Windows packages remain unsigned. Packages were generated and installed
  locally before GitHub publication. Consult the corresponding GitHub Actions
  run for hosted CI results; local checks are not evidence of hosted CI success.

托盘后台运行不是 Windows 系统服务，不会自动添加开机启动。
休眠、关机或退出用户会话仍可能停止服务与网络连接。

## v1.0.3 Installer And Shutdown / 安装与退出

Verified on 2026-10-17, Windows x64:

- All 119 automated tests passed, including scoped process detection, hidden
  window close requests, active-job protection, and shutdown timeout handling.
  The production dependency audit reported zero known vulnerabilities.
- An incomplete HTTP request regression test confirms idle server shutdown does
  not wait indefinitely for renderer polling or unfinished request bodies.
- Three consecutive unpacked desktop startup and shutdown checks exited with
  code zero using separate isolated profiles.
- An isolated v1.0.2 installation was upgraded to v1.0.3. A native hidden-window
  fixture accepted normal close when idle and rejected it while simulating a
  busy job. This is not a live robot-task acceptance test.
- The final installer preserved a profile sentinel and left a similarly named
  sibling installation running. Running the installer inside its own target
  directory returned code 30 without changing the application executable.
- The final installed and self-extracting portable applications passed isolated
  startup, bundled-tool, renderer-isolation, health-card, and clean-exit checks.
  The isolated test installation was then successfully uninstalled.
- Application archive checks confirmed version 1.0.3, required runtime files,
  no private runtime roots, and exact correspondence with the changed desktop
  and server source files. Both Windows executables remain unsigned (`NotSigned`).

所有验证使用隔离目录，不导入真实机器人、会话或飞书授权；网页管理服务未重启。
任务保护通过自动测试与原生窗口模拟验证，不声称已完成所有平台的真实任务升级验收。
更新时请先完成任务并退出全部旧版实例，再从下载目录运行新安装包。

## v1.0.2 System Status / 系统状态

Verified on 2026-10-17, Windows x64:

- 111 automated tests passed. Full and production-only dependency audits found
  zero known vulnerabilities at release preparation time.
- Windows installer and portable packages contain the two system status cards,
  Codex CLI login checks, the Powered by JKZeng footer, and version 1.0.2.
- Application archive inspection checked required modules, tool licenses, and
  absence of private runtime and promotional-output root directories.
- Unpacked, self-extracting portable, and installed applications passed isolated
  startup checks: zero inherited bots, no renderer Node integration, visible
  System page, two health cards, working bundled tools, and clean exit.
- The installer completed silently in an isolated E-drive destination, and its
  uninstaller completed after verification. Web-manager data was not imported.
- Bundled versions are Electron 44.8.0, Codex CLI 0.163.0, and Feishu CLI 1.0.98.
  Executables remain unsigned (`NotSigned`).
- Codex status checks are read-only local CLI/login checks, not model requests,
  network reachability checks, or proof of model permissions or available quota.
- Release social assets contain a platform-icon poster and four 1200 x 1600
  feature cards. Development-process wording was removed; fictional-data,
  independent-project, and account-policy qualifications remain.

所有桌面验证使用隔离目录，不导入真实机器人或飞书授权。
Codex 可沿用当前系统用户已有授权；验证结果不声称四个平台全部完成实机扫码与投递验收。

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
