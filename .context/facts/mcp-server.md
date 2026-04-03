# MCP Server Details

## File: `src/mcp/server.ts`

## Session Tracking
- Tracks all tool calls during a session
- Auto-writes session summary to `sessions/` on graceful shutdown (SIGTERM/SIGINT)
- Works with ALL MCP clients — no hooks required

## Auto-Purge Detection
- `context_write` checks for overlapping entries on same topic
- Warns about potential supersedes
- Optional `supersedes` parameter for auto-delete of old entry

## Tool Annotations
All tools have MCP annotations for better client display.

## Prompts
2 MCP prompts registered (in addition to 6 tools).

## Resources
MCP resources registered for direct file access.

## Starting the Server
```bash
npx repomemory serve
npm run dev -- serve --dir /path/to/repo
```

## Tool Integrations

### Claude Code
`repomemory setup claude` writes MCP server to `~/.claude.json` + post-commit hook to `.claude/hooks/`.

### Cursor (v1.10.0)
`repomemory setup cursor` installs:
- MCP server in `~/.cursor/mcp.json` (global, auto-starts in every project)
- Rules file at `.cursor/rules/repomemory.mdc` (teaches Cursor AI to use MCP tools)
- 6 slash commands in `.cursor/commands/`:
  - `/repomemory-analyze` — full repo analysis via Cursor's AI
  - `/repomemory-orient` — quick project orientation
  - `/repomemory-search` — search knowledge base
  - `/repomemory-record` — record a fact, decision, or regression
  - `/repomemory-session` — save session summary
  - `/repomemory-status` — show context coverage

**No API key required** — Cursor users populate `.context/` entirely through Cursor's built-in AI via MCP tools.

### Other Tools
- Copilot: `.github/copilot-instructions.md`
- Windsurf: `.windsurfrules`
- Cline: `.clinerules`
- Aider: `.aider.conf.yml`
- Continue: `.continue/rules/repomemory.md`

## Skills
- `skills/repomemory/SKILL.md` — main skill
- `skills/session-start/SKILL.md` — session start behavior
- `skills/session-end/SKILL.md` — session end behavior

## Server Config
`server.json` — MCP registry metadata, version auto-synced from package.json via `npm run sync:versions`