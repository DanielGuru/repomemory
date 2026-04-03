# repomemory — Agent Instructions

## Repository Memory (repomemory)

This repo uses [repomemory](https://github.com/DanielGuru/repomemory) for persistent AI memory.

**IMPORTANT: Before starting ANY task, you MUST call `context_search` with relevant
keywords. This is NOT optional. The knowledge base contains architecture docs,
past decisions, and known regressions that WILL save you from mistakes.
Do NOT skip this step even if the task seems simple.**

**ALWAYS at the start of every task:**

1. Call `context_search` with keywords related to your task
2. If this is a new session, call `context_auto_orient` for a full project overview
3. NEVER propose changes without first checking for past decisions

**During your session:**

- ALWAYS use `context_write` to record discoveries, decisions, and gotchas
- ALWAYS use `context_delete` to remove stale or incorrect knowledge
- Record coding preferences in `context_write(category="preferences", ...)`

**Before modifying code:**

- You MUST search for known regressions related to the component
- You MUST check for past decisions before proposing alternatives

**At end of session (REQUIRED):**

- Write a session summary: `context_write(category="sessions", ...)`
- Route discoveries to the right category (facts/, decisions/, preferences/)

## What This Is

A CLI tool + MCP server that gives AI coding agents persistent, structured memory for repositories. Agents can search, write, and delete knowledge that persists across sessions. Features hybrid keyword + semantic search, auto-session capture, intelligent category routing, auto-purge detection, and **global developer context** that follows you across all repos.

**npm package:** `repomemory`
**Repo:** https://github.com/DanielGuru/repomemory

## Architecture

```
src/
├── index.ts                  # CLI entry point (Commander.js). 11 commands. Global error handlers.
├── commands/
│   ├── init.ts               # Scaffolds .context/ directory + .repomemory.json config.
│   │                           Exports CLAUDE_MD_BLOCK with MUST/ALWAYS agent instructions.
│   ├── analyze.ts            # AI-powered repo analysis. System prompt, orchestration,
│   │                           spinner, dry-run, merge mode, retry with backoff.
│   ├── sync.ts               # Reads git log → writes to .context/changelog/YYYY-MM.md
│   │                           with commit hash deduplication.
│   ├── serve.ts              # Thin wrapper that calls startMcpServer()
│   ├── setup.ts              # Configures 7 tools: Claude, Cursor, Copilot, Windsurf,
│   │                           Cline, Aider, Continue.
│   ├── status.ts             # Beautiful coverage bars, freshness indicators, suggestions.
│   ├── wizard.ts             # Interactive guided setup using @clack/prompts.
│   ├── dashboard.ts          # Localhost web UI with edit, server-side search, export.
│   ├── hook.ts               # Git post-commit hook install/uninstall.
│   ├── go.ts                 # One-command setup: init + analyze + setup claude + global profile.
│   ├── search.ts             # CLI search across repo + global context. Hybrid FTS5 + vector.
│   ├── risk.ts               # Git intelligence CLI: hotspots, co-change, ownership analysis.
│   └── global.ts             # Manage global developer context (~/.repomemory/global/).
│                               list, read, write, delete, export, import subcommands.
├── mcp/
│   └── server.ts             # MCP server. 7 tools + 2 prompts + resources.
│                               Dual-store: repo (.context/) + global (~/.repomemory/global/).
│                               Scope routing: preferences→global, everything else→repo.
│                               Session tracking, auto-capture on shutdown,
│                               intelligent category routing, auto-purge detection,
│                               progressive disclosure (compact/full), write-nudge.
└── lib/
    ├── ai-provider.ts        # Multi-provider abstraction (Anthropic, OpenAI, Gemini, Grok).
    │                           Anthropic uses streaming. Gemini uses systemInstruction.
    │                           AIError class with isRetryable. Cost estimation.
    ├── embeddings.ts          # Embedding provider abstraction (OpenAI, Gemini).
    │                           cosineSimilarity(). createEmbeddingProvider() with auto-detect.
    ├── config.ts              # Loads .repomemory.json with Zod validation. Single source
    │                           of DEFAULT_CONFIG truth. Embedding + global context config.
    │                           resolveGlobalDir() for ~ expansion.
    ├── context-store.ts       # CRUD + delete for .context/ files. Category validation.
    │                           Sanitized filenames with NFKD unicode normalization.
    │                           forAbsolutePath() factory for global store.
    ├── search.ts              # sql.js (Wasm) FTS5 + optional vector search.
    │                           Hybrid scoring (alpha * keyword + (1-alpha) * semantic).
    │                           DB persistence (loads from disk on restart).
    │                           Incremental indexEntry() and removeEntry() methods.
    ├── json-repair.ts         # JSON extraction/repair pipeline. extractJSON, fixJsonNewlines,
    │                           repairTruncatedJSON. Extracted from analyze.ts for testability.
    ├── git.ts                 # Git info extraction using execFileSync (no shell injection).
    │                           getLastCommitHash() for sync deduplication.
    ├── git-intelligence.ts    # Git history analysis: hotspots (churn×commits), co-change
    │                           detection (Jaccard similarity), file ownership & bus factor.
    │                           analyzeGitIntelligence() for overview, assessFileRisk() for targets.
    └── repo-scanner.ts        # Walks repo tree respecting .gitignore, detects languages/
                                frameworks across JS, Python, Rust, Go, Ruby ecosystems.
```

## Key Technical Decisions

- **TypeScript + ESM** — `"type": "module"` in package.json. All imports use `.js` extensions. `moduleResolution: "nodenext"` in tsconfig.
- **sql.js (Wasm)** — No native compilation needed. Install works everywhere instantly.
- **Hybrid search** — FTS5 keyword search + optional vector search via API-based embeddings (OpenAI/Gemini). Falls back gracefully to keyword-only when no embedding API key is available.
- **DB persistence** — Search DB loaded from disk on restart to avoid re-embedding. Fresh rebuild only when entry count changes.
- **Streaming for Anthropic** — SDK requires streaming for responses >10 minutes. Uses `stream()`, not `create()`.
- **JSON extraction pipeline** — Models wrap output in code fences or produce truncated JSON. `json-repair.ts` has multi-strategy parser. This is fragile — be careful changing it.
- **Progressive disclosure** — `context_search` returns compact one-line results by default (~50 tokens each). Use `detail="full"` for longer snippets.
- **Intelligent category routing** — `detectQueryCategory()` auto-routes queries to the right category based on keyword heuristics (e.g., "why X" → decisions, "bug in X" → regressions).
- **Auto-purge detection** — `context_write` checks for overlapping entries and warns about potential supersedes. Optional `supersedes` parameter for auto-delete.
- **Auto-session capture** — MCP server tracks all tool calls and auto-writes a session summary on graceful shutdown (SIGTERM/SIGINT).
- **6 categories** — facts, decisions, regressions, sessions, changelog, preferences (new in v1.1).
- **Global context layer (v1.2)** — Developer preferences at `~/.repomemory/global/`, auto-scaffolded on first run. `preferences/` category defaults to global scope, everything else defaults to repo. Two separate search DBs merged at result level. Optional `scope` parameter on all tools for explicit override.
- **Scope routing** — `resolveScope(category, explicitScope?)` in server.ts. preferences→global, everything else→repo. Repo entries shadow global entries with same category/filename.
- **Zod config validation** — .repomemory.json is validated on load. Bad types get a warning, not a crash.
- **@clack/prompts for wizard** — Beautiful interactive CLI with spinner, select, multiselect, confirm.

## How to Work on This

```bash
# Install
npm install

# Dev (runs TypeScript directly)
npm run dev -- wizard
npm run dev -- go --dir /path/to/repo
npm run dev -- analyze --dir /path/to/repo --verbose
npm run dev -- serve --dir /path/to/repo
npm run dev -- dashboard

# Build
npm run build

# Test
npm test

# Test built version
node dist/index.js --help
```

## CLI Commands

| Command           | File         | Description                                                         |
| ----------------- | ------------ | ------------------------------------------------------------------- |
| `go`              | go.ts        | One-command setup (global profile + init + analyze + setup)         |
| `wizard`          | wizard.ts    | Interactive guided setup                                            |
| `init`            | init.ts      | Scaffold .context/                                                  |
| `analyze`         | analyze.ts   | AI analysis (--dry-run, --merge)                                    |
| `sync`            | sync.ts      | Git history sync                                                    |
| `serve`           | serve.ts     | MCP server                                                          |
| `setup <tool>`    | setup.ts     | Tool integration (7 tools)                                          |
| `status`          | status.ts    | Coverage + freshness                                                |
| `search <query>`  | search.ts    | Search knowledge base from terminal (--category, --limit, --detail) |
| `risk`            | risk.ts      | Git intelligence: hotspots, co-change, ownership                    |
| `doctor`          | doctor.ts    | Diagnostics, health checks, support bundles                         |
| `dashboard`       | dashboard.ts | Web UI on localhost:3333                                            |
| `hook <action>`   | hook.ts      | Git hook install/uninstall                                          |
| `global <action>` | global.ts    | Manage global context (list/read/write/delete/export/import)        |

## MCP Tools

| Tool                  | Description                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------- |
| `context_search`      | Hybrid FTS5 + vector search across repo + global. Intelligent category routing. Scope filter. |
| `context_write`       | Write/append with scope routing (preferences→global). Auto-purge detection. Supersedes.       |
| `context_delete`      | Remove entries. Tries repo first, falls back to global. Scope parameter.                      |
| `context_list`        | List entries from both stores with [repo]/[global] provenance tags.                           |
| `context_read`        | Read full content. Repo-first, falls back to global.                                          |
| `context_auto_orient` | Project orientation: index + global preferences + repo preferences + sessions + recent.       |
| `context_risk`        | Git intelligence: hotspot scores, co-change partners, ownership, bus factor, risk level.       |

## Common Issues

### "Failed to parse AI response as JSON"

The AI wrapped output in fences or was truncated. The parser in `json-repair.ts` handles most cases. If a new model produces a different format, add a strategy there.

### "Streaming is required for operations that may take longer than 10 minutes"

Anthropic SDK error. The provider already uses `.stream()`. If you see this, someone switched back to `.create()`.

### Build produces no shebang

`scripts/build.js` handles this. Check that script if `dist/index.js` doesn't have a shebang.

## Dependencies

- `@anthropic-ai/sdk` — Claude API (streaming)
- `@google/generative-ai` — Gemini API + embeddings
- `openai` — OpenAI + Grok + embeddings (text-embedding-3-small, falls back after Gemini in auto-detect)
- `@modelcontextprotocol/sdk` — MCP server protocol
- `sql.js` — Wasm SQLite for FTS5 search (zero native deps)
- `commander` — CLI framework
- `chalk` — Terminal colors
- `ora` — Spinners for long operations
- `@clack/prompts` — Beautiful interactive CLI prompts
- `zod` — Schema validation

## Releasing

Auto-publishing is configured via GitHub Actions. Full release checklist:

```bash
# 1. Bump version in package.json
# 2. Update CHANGELOG.md with new version section
# 3. Sync server.json (automatic on build, but verify):
npm run sync:versions

# 4. Verify everything passes:
npm run check:release   # version parity + changelog check
npm run lint            # typecheck + prettier
npm test                # all tests
npm run build           # compile + sync versions

# 5. Commit, push, tag, push tag:
git add -A && git commit -m "v1.x.x — description"
git push origin main
git tag v1.x.x && git push origin v1.x.x

# 6. Wait for GitHub Actions release workflow to complete:
gh run list --limit 1

# 7. Upgrade locally:
npm install -g repomemory@latest && repomemory --version
```

**Important:**

- `server.json` version MUST match `package.json` — `npm run sync:versions` handles this
- `npm run check:release` validates version parity, changelog entry, and README integrity
- The `release.yml` workflow runs lint, typecheck, tests, E2E, build, then `npm publish --provenance`
- If CI fails after tagging, fix the issue, delete the tag (`git tag -d vX && git push origin :refs/tags/vX`), push the fix, then re-tag
- Never force-push tags — delete and recreate instead
- The `NPM_TOKEN` secret is configured in the repo

## Don't

- Don't change the `.context/` directory structure without updating `context-store.ts`, `search.ts`, AND `server.ts`
- Don't switch Anthropic back to non-streaming `create()` — it times out on large repos
- Don't hardcode provider-specific logic in `analyze.ts` — use `ai-provider.ts` abstraction
- Don't add heavy dependencies — this needs to install fast via `npx`
- Don't use execSync for git commands — use execFileSync to prevent shell injection
- Don't duplicate DEFAULT_CONFIG — it lives in `config.ts` only
- Don't add embedding logic outside `embeddings.ts` — it's the single abstraction for all providers
- Don't break the 7-tool integration (not just Claude Code)
- Don't make the MCP server depend on Claude Code hooks — it must work standalone with any MCP client
- Don't change scope routing defaults without updating both `resolveScope()` in server.ts AND the design doc
- Don't store repo-specific data in `~/.repomemory/global/` — it's personal developer preferences only
- Don't remove backwards compatibility — `enableGlobalContext: false` must make v1.2 behave like v1.1
- Don't call `process.exit()` in setup functions called programmatically — throw errors instead (go.ts catches them)
- Don't use `new Date()` for search index timestamps — always use filesystem mtime from `store.listEntries()` to avoid embedding churn
- Don't add a `categories` config field — categories are hardcoded in `context-store.ts` and `server.ts` (VALID_CATEGORIES). This is intentional.
- Don't claim Node 18 support — `commander@14` requires Node >=20
