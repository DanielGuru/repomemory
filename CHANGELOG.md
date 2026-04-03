# Changelog

## 1.11.0 (2026-04-03)

### New Features
- **Git intelligence** — New `repomemory risk` CLI command and `context_risk` MCP tool. Analyzes git history for hotspot files (high churn), hidden coupling (co-change detection via Jaccard similarity), ownership concentration, and bus factor
- **Risk-aware agent workflow** — `context_auto_orient` now surfaces top risk hotspots at session start; `start-task` prompt instructs agents to call `context_risk` before modifying files; CLAUDE_MD_BLOCK includes risk assessment in "Before modifying code" instructions

### Fixes
- **`process.exit(1)` in risk command** — Replaced with `throw` to prevent killing the process when called programmatically (e.g., from `go.ts`)
- **MCP manifest missing `context_risk`** — Added to `server.json` so MCP clients can discover the tool
- **README gaps** — Added `context_risk` to MCP tools table, `risk` command to commands list, updated tool count from 6 to 7

## 1.10.0 (2026-02-22)

### New Features
- **Deep Cursor integration** — `repomemory setup cursor` now installs MCP server, `.cursor/rules/repomemory.mdc`, and 6 slash commands (`/repomemory-analyze`, `/repomemory-orient`, `/repomemory-search`, `/repomemory-record`, `/repomemory-session`, `/repomemory-status`)
- **No API key required for Cursor** — Cursor users can populate `.context/` entirely through Cursor's built-in AI via the MCP tools, no external API key needed
- **Wizard cursor-only mode** — When no API keys are detected, the wizard offers a "None — I use Cursor" option that skips external analysis and sets up Cursor-driven workflows
- **Auto-detect Cursor in `go`** — `repomemory go` now auto-detects `~/.cursor/` and configures Cursor alongside Claude Code

### Fixes
- **Invalid category in Cursor analyze command** — Fixed `context_write(category="index")` reference (not a valid category) in the generated `/repomemory-analyze` command

## 1.9.0 (2026-02-20)

### Security
- **Path containment guard** — `assertPathContainment()` defense-in-depth check on all context store read/write/delete/append operations; blocks path traversal even if category validation is bypassed
- **API key redaction** — `redactError()` strips API keys from error messages before debug logging (`REPOMEMORY_DEBUG=1`); covers OpenAI `sk-*`, Gemini `AIza*`, Bearer tokens, and query params

### New Features
- **`search --json`** — machine-readable JSON output for CLI search results
- **`maxEmbeddingChars`** — configurable in `.repomemory.json` (default: 8000); controls max content length sent to embedding API

### Improvements
- **Object.create hack removed** — `ContextStore.forAbsolutePath()` now uses clean constructor instead of prototype manipulation
- **Score clamping** — hybrid merge clamps normalized keyword/semantic scores to [0, 1] via `Math.max(0, Math.min(1, ...))`
- **dirty flag consistency** — `SearchIndex.save()` resets dirty flag; `rebuild()` sets it; `close()` only saves when needed
- **Embedding error visibility** — embedding failures logged with redacted error details when `REPOMEMORY_DEBUG=1`

## 1.8.1 (2026-02-20)

### Fixes
- **Timestamp normalization** — truncate mtime to second precision in search index to prevent filesystem granularity mismatches causing unnecessary re-embedding
- **Embedding truncation visibility** — long content truncated for embedding API now logged with `REPOMEMORY_DEBUG=1`; configurable `maxEmbeddingChars` in SearchIndex constructor
- **Hybrid score clamping** — normalized keyword/semantic scores clamped to [0, 1] to prevent FTS5 rank edge cases from producing weird merge results

## 1.8.0 (2026-02-20)

### New Features
- **Search explain mode** — `repomemory search --explain` and MCP `context_search(explain=true)` show keyword vs semantic score breakdown for every result. Debug search quality instantly.
- **Incremental analysis** — `repomemory analyze --incremental` only re-analyzes files changed since last analysis (tracked via git commit hash). Saves time and API costs on large repos.
- **Doctor embeddings diagnostics** — `repomemory doctor` now shows embedding provider status, vector dimensions, cache stats, and warns when embeddings are misconfigured.

## 1.7.1 (2026-02-20)

### Fixes
- **MCP resources contract** — `root/index.md` was listed via `ListResources` but rejected by `ReadResource`; now filtered from listing
- **Node engine floor** — bumped `engines` to `>=20` to match `commander@14` requirement; updated CONTRIBUTING.md and AGENTS.md
- **Embedding churn** — `context_write` incremental indexing used `new Date()` instead of filesystem mtime, causing unnecessary re-embedding on rebuild
- **Dashboard sanitizer** — added `iframe/object/embed/form` stripping and explicit marked.js config for defense-in-depth
- **`global` CLI config** — now reads `.repomemory.json` from cwd instead of hardcoded defaults, respecting custom `globalContextDir`
- **Config `categories` field** — removed unused schema field that appeared configurable but was hardcoded everywhere
- **Scanner ignore matching** — `shouldIgnore()` now tests full relative paths, not just basenames; path-based gitignore patterns work correctly

## 1.7.0 (2026-02-20)

### New Features
- **`repomemory doctor`** — Diagnostics command with config/API-key checks, `.context` integrity, search index health probe, MCP setup checks, JSON output (`--json`), and support bundle (`--output`)
- **Non-interactive setup** — `go` and `wizard` now support `--yes` / `--defaults` / `--no-prompt` flags for deterministic CI-safe usage
  - Additional flags: `--max-files`, `--embedding-provider none`, `--tools`, `--skip-analyze`

### Improvements
- **Dashboard optimization** — `/api/entries` now supports pagination (`offset`/`limit`), compact payload mode (`compact=1`), metadata-only mode (`meta=1`), and ETag-based conditional requests
- **Dashboard polling** — Replaced full-payload polling with lightweight metadata polling + revision-based refresh
- **Release consistency** — `npm run sync:versions` keeps `server.json` aligned with `package.json`; `npm run check:release` validates version parity and changelog presence
- **CI workflows** — Updated CI with lint/typecheck, release consistency checks, and E2E smoke tests
- **`server.json` synced** — Was stuck at 1.3.0, now auto-synced to package version

### Testing
- **MCP contract tests** — Real client/server integration tests covering list/read/write/delete/search/orient and repo/global scope routing
- **CLI E2E smoke tests** — `go --yes`, `doctor --json`, `setup cursor`, `status`, `search`
- **Release scripts** — `check:release` and `sync:versions` prevent version drift

## 1.1.1 (2026-02-18)

### Security
- Fix path traversal in `readEntry`/`deleteEntry` — category now validated before file access
- Fix path traversal in MCP resource handler — validate category extracted from URI
- Fix XSS in dashboard — sanitize `marked.parse` output (strip scripts, event handlers)
- Fix dashboard CORS — restrict to same origin, bind to `127.0.0.1` only
- Fix shell injection — use `execFile` instead of `exec` for browser open

### Bug Fixes
- Fix version drift — `serve.ts` showed v0.2.0, `server.ts` hardcoded 1.1.0 (now imported from package.json)
- Fix `appendEntry` — no longer prepends blank lines on new files
- Fix `detectQueryCategory` false positives — "pattern"/"format" no longer misroute to preferences
- Fix dashboard search dedup — match by `category/filename` not just `filename`
- Fix FTS5 OR fallback — construct independent query instead of reusing params
- Fix Float32Array buffer sharing — copy buffer to avoid sql.js internal reuse
- Fix cleanup double-fire — guard against concurrent SIGTERM/SIGINT
- Fix sql.js singleton — allow retry on init failure
- Fix hook uninstall — marker-based removal avoids over-matching other hooks
- Fix `server.json` entry point — args now point to correct CLI path
- Fix unicode filenames — hash-based fallback for all-non-ASCII input

### Performance
- Search `rebuild()` is now incremental — preserves existing embeddings across restarts
- Gemini embedding calls parallelized in chunks of 5 (was sequential)
- Embedding dimensions detected dynamically (was hardcoded to 1536)

### Internal
- Extract `STARTER_INDEX` and `writeDefaultConfigFile` to eliminate init/go duplication
- Wizard uses shared helpers directly (no interleaved console output)
- Remove dead `initialized` field from SearchIndex
- Add `context_auto_orient` to serve.ts tool log
- 5 new tests (146 total): path traversal, unicode filenames, appendEntry, preferences category

## 1.1.0 (2026-02-18)

### New Features
- **One-command setup** — `npx repomemory go` replaces 4-step init/analyze/setup flow
- **Hybrid search** — Optional vector/semantic search via OpenAI or Gemini embeddings alongside FTS5 keyword search
- **Intelligent category routing** — Search queries auto-route to the right category (e.g., "why X" → decisions/)
- **Auto-session capture** — MCP server tracks tool calls and auto-writes session summary on shutdown
- **Progressive disclosure** — Search returns compact one-line results by default, `detail="full"` for longer snippets
- **Auto-purge detection** — context_write warns about potentially superseded entries, optional `supersedes` parameter
- **preferences/ category** — New category for coding style, preferred patterns, tool configs
- **context_auto_orient tool** — One-call project orientation: index + preferences + sessions + recent changes
- **Dashboard edit mode** — Edit context entries inline in the web dashboard
- **Dashboard server-side search** — Search hits the FTS5 index instead of client-side filtering
- **Dashboard export** — Export all context as JSON
- **Dashboard real-time polling** — Auto-refreshes when context files change
- **Markdown rendering** — Dashboard uses marked.js for proper markdown rendering (CDN, with regex fallback)
- **session-start / session-end skills** — New Claude Code skills for session management
- **Write-nudge** — MCP server suggests context_write to agents that only read without writing

### Improvements
- CLAUDE.md block rewritten with MUST/ALWAYS/NEVER directive language for stronger agent adoption
- MCP server upgraded from 5 to 6 tools with tool annotations
- end-session prompt now instructs agents to route conclusions to the right categories
- Search DB persisted to disk and loaded on restart (avoids full rebuild)
- Empty-state messaging improved across all tools
- context_list supports compact mode (default) for token efficiency
- context_search supports detail parameter (compact/full)

### Bug Fixes
- context_read now validates category parameter
- Fallback text search uses correct category after auto-routing retry

## 1.0.0 (2026-02-18)

### New Features
- **Interactive wizard** (`repomemory wizard`) — guided setup with @clack/prompts
- **Web dashboard** (`repomemory dashboard`) — localhost dark-mode UI with markdown rendering, search, category filtering
- **Status command** (`repomemory status`) — coverage bars, freshness indicators, stale warnings
- **Git hooks** (`repomemory hook install`) — auto-sync changelog on commits
- **MCP prompts** — `start-task` and `end-session` conversation starters
- **`context_delete` MCP tool** — agents can prune stale knowledge
- **`--dry-run` mode** — preview analysis with cost estimate, no API call
- **`--merge` mode** — update context without overwriting manual edits
- **Retry with exponential backoff** on AI provider failures
- **API key validation** before expensive analysis calls
- **Cost estimation** before and after analysis
- **Claude Code plugin** with `.mcp.json` and `/repomemory` skill
- **MCP tool annotations** — `readOnlyHint`/`destructiveHint` for directory compliance
- **MCP registry metadata** — `server.json` for registry submission

### Tool Integrations (7 total)
- Claude Code, Cursor, GitHub Copilot, Windsurf, Cline, Aider, Continue

### Infrastructure
- Replaced `better-sqlite3` with `sql.js` (Wasm) — zero native compilation, instant `npx` install
- FTS5 search with automatic fallback to scored LIKE queries
- Zod schema validation for `.repomemory.json`
- `execFileSync` for all git operations (no shell injection)
- `.gitignore` support in repo scanner
- Multi-ecosystem framework detection (JS, Python, Rust, Go, Ruby)
- 106 vitest tests across 4 suites
- GitHub Actions CI (Node 18/20/22 matrix) + release workflow
- Issue templates, PR template, contributing guide

### Bug Fixes
- Fixed duplicate `DEFAULT_CONFIG` between init.ts and config.ts
- Fixed wrong GitHub URL in init template
- Fixed Gemini provider to use `systemInstruction` instead of XML wrapper
- Fixed monorepo workspace detection logic
- Fixed sync deduplication (commit hash tracking)
- Removed dead code (`resolveApiKey`, unused `glob` dep)
- Added `unhandledRejection` handler

## 0.1.0 (2026-02-17)

Initial release.
- CLI with 6 commands (init, analyze, sync, serve, setup, status)
- MCP server with 4 tools (search, write, list, read)
- FTS5 search via better-sqlite3
- Support for Anthropic, OpenAI, Gemini, Grok providers
- Setup for Claude Code, Cursor, GitHub Copilot
