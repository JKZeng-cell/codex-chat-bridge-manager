# lark-cli Quick Reference

This project already installs the official Feishu CLI: `@larksuite/cli`.

Direct entrypoint:

```bash
lark-cli --help
```

Preferred direct global CLI for this bridge:

```bash
lark-cli --help
```

The bridge now calls the configured global `lark-cli` binary directly. Pass `--as user` or `--as bot` explicitly when the operation depends on identity.

## Command layers

`lark-cli` exposes three useful layers:

1. Shortcut commands such as `im +messages-send` or `calendar +agenda`
2. Nested API resource commands such as `calendar events list`
3. Raw OpenAPI access through `api`

Examples:

```bash
lark-cli calendar +agenda
lark-cli im +messages-send --chat-id "oc_xxx" --text "Hello"
lark-cli calendar events --help
lark-cli api GET /open-apis/calendar/v4/calendars
```

## Auth and identity

Initialize the CLI with app credentials:

```bash
lark-cli config init --app-id <APP_ID> --app-secret-stdin --brand feishu
```

Grant user-scoped permissions when you need user-only APIs:

```bash
lark-cli auth login --domain approval,apps,attendance,base,calendar,contact,docs,drive,event,im,mail,markdown,minutes,okr,sheets,slides,task,vc,wiki --recommend
```

Check status:

```bash
lark-cli auth status
lark-cli config show
lark-cli doctor
```

Notes:

- Shortcut commands are the preferred path for Codex prompts.
- Use `--as user` for user-owned resources such as calendar, Drive, mail, attendance, and search. Use `--as bot` for app-owned automation when appropriate.
- The bridge wrapper auto-appends the configured identity for shortcut and nested identity-aware commands unless `--as` is already present.
- `docs +search` and `im +messages-search` are forced to `--as user`.
- For agent-friendly login, prefer `lark-cli auth login --scope "<scope>" --no-wait --json`, send the verification URL to the user, then complete later with `--device-code`.
- If JSON output contains `_notice.update`, run `lark-cli update` and restart the agent or bridge so updated skills load.
- If a command exits with `confirmation_required`, do not add `--yes` until the user explicitly approves the high-risk write.

## Bridge-relevant modules

Useful top-level help commands:

```bash
lark-cli im --help
lark-cli docs --help
lark-cli base --help
lark-cli sheets --help
lark-cli calendar --help
lark-cli task --help
lark-cli drive --help
lark-cli mail --help
lark-cli approval --help
lark-cli vc --help
lark-cli whiteboard --help
```

High-value shortcuts for this bridge:

- `im +chat-messages-list`
- `im +threads-messages-list`
- `im +messages-send`
- `im +messages-reply`
- `im +messages-search`
- `im +messages-resources-download`
- `docs +create --api-version v2`
- `docs +fetch --api-version v2`
- `docs +update --api-version v2`
- `docs +search`
- `drive +inspect`
- `drive +upload`
- `drive +download`
- `drive +import`
- `drive +export`
- `drive +sync`
- `mail +triage`
- `mail +message`
- `mail +send`
- `mail +reply`
- `mail +draft-edit`
- `approval`
- `attendance`
- `contact +search-user`
- `minutes`
- `vc`
- `markdown`
- `okr`
- `slides`
- `whiteboard`
- `base +base-create`
- `base +table-list`
- `base +field-list`
- `base +record-upsert`
- `base +data-query`
- `base +view-list`
- `sheets +create`
- `sheets +read`
- `sheets +write`
- `calendar +agenda`
- `calendar +freebusy`
- `calendar +create`
- `calendar +suggestion`
- `task +create`
- `task +update`
- `task +complete`
- `task +comment`
- `task +tasklist-create`
- `task +get-my-tasks`

## Why both SDK and CLI exist here

The bridge runtime itself uses the Feishu Node SDK long-connection mode to receive messages and push streaming replies.

The CLI is still important because it gives Codex a practical local operator tool for:

- searching Feishu resources before writing
- reading content and metadata without building custom API calls
- performing structured write operations across Docs, Drive, Base, Sheets, Calendar, Task, Mail, Approval, VC, Wiki, Whiteboard, and related modules
- debugging permission gaps or payload details quickly

## References

- [larksuite/cli](https://github.com/larksuite/cli)
- [Feishu Open Platform](https://open.feishu.cn/document/)
