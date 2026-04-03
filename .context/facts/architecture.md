# Architecture

## Overview
repomemory is a single-package CLI + MCP server. No microservices. Deployed as an npm package.

## Entry Points
- `src/index.ts` — CLI entry (Commander.js), registers 11 commands, global error handlers
- `src/mcp/server.ts` — MCP server with 6 tools + 2 prompts + resources
- `dist/index.js` — compiled binary (has shebang, set by `scripts/build.js`)

## Command → File Map
| Command | File |
|---------|------|
| `go` | `src/commands/go.ts` — init + analyze + setup claude + auto-detect cursor |
| `wizard` | `src/commands/wizard.ts` — interactive setup via @clack/prompts (cursor-only mode) |
| `init` | `src/commands/init.ts` — scaffolds `.context/` + `.repomemory.json` |
| `analyze` | `src/commands/analyze.ts` — AI-powered repo analysis |
| `sync` | `src/commands/sync.ts` — git log → `.context/changelog/YYYY-MM.md` |
| `serve` | `src/commands/serve.ts` — thin wrapper calling `startMcpServer()` |
| `setup` | `src/commands/setup.ts` — 7 tool integrations (claude, cursor, copilot, windsurf, cline, aider, continue) |
| `status` | `src/commands/status.ts` — coverage bars + freshness |
| `search` | `src/commands/search.ts` — CLI search with --json, --explain |
| `doctor` | `src/commands/doctor.ts` — diagnostics + health checks |
| `dashboard` | `src/commands/dashboard.ts` — localhost:3333 web UI |
| `hook` | `src/commands/hook.ts` — git post-commit hook install/uninstall |
| `global` | `src/commands/global.ts` — manage global developer context |

## MCP Tools (src/mcp/server.ts)
| Tool | Description |
|------|-------------|
| `context_search` | Hybrid FTS5 + vector search, intelligent category routing, compact/full detail |
| `context_write` | Write/append with auto-purge detection + supersedes support |
| `context_delete` | Remove stale entries |
| `context_list` | List entries compact/full |
| `context_read` | Read full file content |
| `context_auto_orient` | One-call orientation: index + sessions + recent changes + preferences |

## Lib Layer (src/lib/)
- `config.ts` — loads `.repomemory.json`, Zod validation, `DEFAULT_CONFIG`
- `context-store.ts` — CRUD for `.context/` files, category validation, sanitized filenames, freshness tracking
- `search.ts` — sql.js FTS5 + optional vector search, hybrid scoring (`alpha * keyword + (1-alpha) * semantic`), DB persistence
- `embeddings.ts` — OpenAI/Gemini embedding abstraction, `cosineSimilarity()`, `createEmbeddingProvider()`
- `ai-provider.ts` — Anthropic/OpenAI/Gemini/Grok abstraction, `AIError` with `isRetryable`, cost estimation
- `git.ts` — `execFileSync` (no shell injection), `getLastCommitHash()` for dedup
- `repo-scanner.ts` — walks repo tree respecting `.gitignore`, detects languages/frameworks
- `json-repair.ts` — `extractJSON`, `fixJsonNewlines`, `repairTruncatedJSON` pipeline

## Storage Layout
```
.context/
├── index.md              # Quick orientation
├── facts/                # How things work
├── decisions/            # Why choices were made
├── regressions/          # Known bugs/fixes
├── preferences/          # Developer coding style
├── sessions/             # Auto-captured session summaries
└── changelog/            # Monthly git history (YYYY-MM.md)
```

## Config File
`.repomemory.json` in repo root — validated by Zod on load. Bad types warn, don't crash.

## Supported AI Providers
| Provider | Env Var |
|----------|---------|
| `anthropic` | `ANTHROPIC_API_KEY` |
| `openai` | `OPENAI_API_KEY` |
| `gemini` | `GEMINI_API_KEY` |
| `grok` | `GROK_API_KEY` |