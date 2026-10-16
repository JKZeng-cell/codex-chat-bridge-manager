# Security / 安全说明

## Local Trust Boundary / 本地信任边界

This tool runs Codex on your computer in response to chat messages. Only connect
trusted accounts and chats. Use user/chat allowlists and a restricted working
directory. A command prefix is not an authorization mechanism.

机器人消息可触发本机 Codex 操作。仅与可信用户共享，配置用户与会话白名单，限制工作目录。
命令前缀并不等于访问控制；不要为了方便关闭沙箱或扩大目录授权。

The manager listens on `127.0.0.1:3210` by default, rejects foreign Host headers
and cross-origin writes, and caps JSON bodies at 1 MiB. It has no login system.
Do not expose it through a proxy, public interface, port forwarding, or tunnel.
Any trusted local process or browser user with access can administer it.

管理界面没有独立登录机制，请勿公网暴露、反向代理或穿透。Host/Origin 检查不替代身份认证。

## Credentials And Data / 凭据与数据

Bot secrets, binding state, CLI authorization, history, downloads, and logs remain
in local `.env`, `state/`, and `runs/` (or your configured directories). Some
credentials are stored as plaintext JSON; OS keychain protection is used only
where the official CLI supports it. Protect these directories and backups.

凭据不是全部加密存储。不要提交配置、授权二维码、设备码、会话、附件、日志或真实截图。
公开截图均使用虚拟演示数据。前端会转义原始 HTML，只允许 HTTP(S) Markdown 链接，
但这不保证模型产出的命令可信，执行前仍需遵循 Codex 的权限和审批策略。

## Reporting / 报告问题

Do not put tokens, personal logs, or live authorization links into public issues.
Use GitHub private vulnerability reporting when available; otherwise open an issue
asking for a private reporting channel without disclosing exploit details.
发现安全问题请勿公开密钥或利用细节，优先使用仓库的私密安全报告入口。
