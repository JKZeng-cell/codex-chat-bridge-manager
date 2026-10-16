# Feishu Module Workflows

The bridge now teaches Codex how to operate the current `lark-cli` and installed `lark-*` skills. Core families include:

- Messages
- Docs
- Drive
- Base
- Sheets
- Calendar
- Task
- Approval, Attendance, Contact, Mail, Markdown, Minutes, OKR, Slides, VC, Whiteboard, Wiki

## Preferred CLI

Use the configured global `lark-cli` directly:

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

Rules of thumb:

- Use `--as user` for user-owned resources such as calendar, Drive, mail, attendance, and search. Use `--as bot` for app-owned automation when appropriate.
- The local wrapper auto-appends the configured identity to shortcut and nested identity-aware commands unless `--as` is already present.
- User-only shortcuts like `docs +search` and `im +messages-search` are forced to `--as user`.
- Search and inspect before write operations whenever IDs or URLs are still unknown.
- For newly created docs, sheets, Bases, wiki nodes, or folders, grant the Feishu requester `full_access` through `drive permission.members create` before you finish the task.
- Read the matching local `lark-*` skill before domain-specific work; `lark-shared` covers auth, identity, update notices, and high-risk confirmation.
- If JSON output contains `_notice.update`, finish the current task, then run `lark-cli update` and restart the agent or bridge.
- If a command exits with `confirmation_required`, do not add `--yes` until the user explicitly approves the high-risk write.

## Messages

Read history:

```bash
lark-cli im +chat-messages-list --chat-id "<oc_xxx>"
lark-cli im +chat-messages-list --user-id "<ou_xxx>"
```

Read a topic thread:

```bash
lark-cli im +threads-messages-list --message-id "<om_xxx>"
```

Send or reply:

```bash
lark-cli im +messages-send --chat-id "<oc_xxx>" --text "Hello"
lark-cli im +messages-reply --message-id "<om_xxx>" --markdown "Working on it"
```

Search or download resources:

```bash
lark-cli im +messages-search --query "deployment error" --start "2026-04-01T00:00:00+08:00"
lark-cli im +messages-resources-download --message-id "<om_xxx>" --file-key "<file_key>" --type file
```

## Docs

Search, create, read, and update cloud docs:

```bash
lark-cli docs +search --query "weekly report" --as user
lark-cli docs +create --api-version v2 --content "<title>Weekly Report</title><p>Progress</p>"
lark-cli docs +fetch --api-version v2 --doc "<url-or-token>"
lark-cli docs +update --api-version v2 --doc "<url-or-token>" --command append --content "<p>Progress</p>"
lark-cli drive permission.members create --params "{\"token\":\"<doc-token>\",\"type\":\"docx\"}" --data "{\"member_id\":\"<requester-open-id>\",\"member_type\":\"openid\",\"type\":\"user\",\"perm\":\"full_access\",\"perm_type\":\"container\"}"
```

## Drive

Inspect URLs, upload/download files, import/export cloud docs, and manage permissions:

```bash
lark-cli drive +inspect --url "<feishu-url>"
lark-cli drive +upload --file "runs/report.pdf" --folder-token "<folder-token>"
lark-cli drive +download --file-token "<file-token>" --output "runs/report.pdf"
lark-cli drive +import --file "data.xlsx" --type bitable
lark-cli drive +export --token "<doc-token>" --type docx --output "runs/doc.docx"
lark-cli drive +sync --local-dir "docs" --folder-token "<folder-token>"
```

## Base

Create or inspect a base:

```bash
lark-cli base +base-create --name "Release Tracker" --time-zone Asia/Shanghai
lark-cli base +base-get --base-token "<base-token>"
lark-cli drive permission.members create --params "{\"token\":\"<base-token>\",\"type\":\"bitable\"}" --data "{\"member_id\":\"<requester-open-id>\",\"member_type\":\"openid\",\"type\":\"user\",\"perm\":\"full_access\",\"perm_type\":\"container\"}"
```

Manage tables, fields, records, filters, and views:

```bash
lark-cli base +table-list --base-token "<base-token>"
lark-cli base +field-list --base-token "<base-token>" --table-id "<table-id>"
lark-cli base +record-upsert --base-token "<base-token>" --table-id "<table-id>" --json "{\"Status\":\"Done\"}"
lark-cli base +data-query --base-token "<base-token>" --dsl "{\"select\":[\"Status\"],\"filter\":{}}"
lark-cli base +view-list --base-token "<base-token>" --table-id "<table-id>"
```

## Sheets

Create, read, write, and inspect spreadsheets:

```bash
lark-cli sheets +create --title "Weekly Metrics" --headers "[\"Metric\",\"Value\"]"
lark-cli sheets +write --url "<sheet-url>" --range "A1:B3" --values "[[\"Builds\",12],[\"Failures\",1]]"
lark-cli sheets +read --url "<sheet-url>" --range "A1:B10"
lark-cli sheets +info --url "<sheet-url>"
lark-cli drive permission.members create --params "{\"token\":\"<sheet-token>\",\"type\":\"sheet\"}" --data "{\"member_id\":\"<requester-open-id>\",\"member_type\":\"openid\",\"type\":\"user\",\"perm\":\"full_access\",\"perm_type\":\"container\"}"
```

## Calendar

Inspect agenda, check free/busy, create meetings, and manage attendees:

```bash
lark-cli calendar +agenda --start "2026-04-03T00:00:00+08:00" --end "2026-04-03T23:59:59+08:00"
lark-cli calendar +freebusy --user-id "<ou_xxx>"
lark-cli calendar +create --summary "Review" --start "2026-04-04T15:00:00+08:00" --end "2026-04-04T15:30:00+08:00" --attendee-ids "<ou_xxx>"
lark-cli calendar event.attendees --help
```

## Task

Create, update, complete, comment, and manage lists or subtasks:

```bash
lark-cli task +create --summary "Fix login bug" --description "Investigate and patch" --due "date:2026-04-10"
lark-cli task +get-my-tasks
lark-cli task +comment --task-id "<task-id>" --content "Root cause confirmed"
lark-cli task +tasklist-create --name "Release Follow-ups"
lark-cli task subtasks create --help
```

## Latest Skill Families

Use `--help` plus the installed skill for these domains before writing:

```bash
lark-cli approval --help
lark-cli attendance --help
lark-cli contact --help
lark-cli mail --help
lark-cli markdown --help
lark-cli minutes --help
lark-cli okr --help
lark-cli slides --help
lark-cli vc --help
lark-cli whiteboard --help
lark-cli wiki --help
```

Important defaults:

- Mail creates drafts by default; only send after explicit user confirmation.
- Past meeting lookups should start with `vc`, not calendar-only search.
- Raw `.md` Drive files belong to `markdown`; importing Markdown into a doc belongs to `drive +import` or `docs` depending on intent.
- PPTX import starts with `drive +import --type slides`; slide-internal edits use `slides`.
- Wiki URLs should be unwrapped with `drive +inspect` before content operations.

## Chat helpers

Inside Feishu chat, the bridge also exposes:

- `/lark-help`
- `/whoami`
- `/status`
- `/help`

`/lark-help` returns task examples covering the current bridge module families.
