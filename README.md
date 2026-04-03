<div align="center">

# repomemory

**Your codebase never forgets.**

AI agents lose context every session. repomemory fixes that — one command creates a persistent, searchable knowledge base that any AI tool can read, search, and write to.

[![npm version](https://img.shields.io/npm/v/repomemory.svg)](https://www.npmjs.com/package/repomemory)
[![npm downloads](https://img.shields.io/npm/dm/repomemory.svg)](https://www.npmjs.com/package/repomemory)
[![license](https://img.shields.io/npm/l/repomemory.svg)](https://github.com/DanielGuru/repomemory/blob/main/LICENSE)
[![CI](https://github.com/DanielGuru/repomemory/actions/workflows/ci.yml/badge.svg)](https://github.com/DanielGuru/repomemory/actions)

```bash
npx repomemory go
```

</div>

---

<div align="center">

<video src="https://github.com/DanielGuru/repomemory/raw/main/repomemory-demo.gif.mp4" width="100%" autoplay loop muted playsinline></video>

</div>

## The Problem

Every time you open a project with Claude Code, Cursor, Copilot, or any AI coding agent:

- It re-discovers your architecture from scratch
- It proposes changes that were already debated and rejected
- It re-introduces bugs that were already fixed

Your `CLAUDE.md` / `.cursorrules` helps, but it's static and gets stale.

## The Solution

```
.context/
├── index.md              ← Quick orientation (loaded every session)
├── facts/                ← Architecture, database, deployment
├── decisions/            ← "We chose Drizzle over Prisma because..."
├── regressions/          ← "This broke before. Here's what happened."
├── preferences/          ← Your coding style — follows you across all repos
├── sessions/             ← Auto-captured AI session summaries
└── changelog/            ← Monthly git history syncs
```

**Facts** tell agents how things work. **Decisions** prevent re-debating. **Regressions** prevent re-breaking. **Preferences** teach agents how you code.

## Quick Start

### With an API key (Claude Code, terminal workflows)

```bash
npx repomemory go
```

One command: sets up global profile, creates `.context/`, configures Claude Code + Cursor, runs AI analysis, prints CLAUDE.md instructions.

### With Cursor (no API key needed)

```bash
npx repomemory setup cursor
```

This installs everything Cursor needs:
- **MCP server** in `~/.cursor/mcp.json` (auto-starts repomemory in every project)
- **Rules** in `.cursor/rules/repomemory.mdc` (teaches Cursor's AI to use context)
- **6 commands** in `.cursor/commands/` (run with `/` in Cursor chat)

Then in Cursor chat, type:
```
/repomemory-analyze
```

Cursor's own AI scans your repo and populates `.context/` via the MCP tools. No external API key required — your Cursor subscription handles it.

**Available Cursor commands:**

| Command | What it does |
|---------|-------------|
| `/repomemory-analyze` | Full repo analysis — populates facts, decisions, index |
| `/repomemory-orient` | Quick orientation at start of session |
| `/repomemory-search` | Search the knowledge base |
| `/repomemory-record` | Record a fact, decision, or regression |
| `/repomemory-session` | Save a session summary |
| `/repomemory-status` | Show context coverage |

### Guided wizard

```bash
npx repomemory wizard
```

Walks through provider selection, tool integration, and first analysis. If no API keys are detected, offers a **"None — I use Cursor"** option that skips external analysis entirely.

### Non-interactive (CI-safe)

```bash
npx repomemory go --yes --provider anthropic --embedding-provider gemini --max-files 80
```

No prompts when `--yes` / `--defaults` / `--no-prompt` is used.

## MCP Server — Agents With Real Memory

The real power is the MCP server. When configured via `repomemory setup claude`, it auto-starts with Claude Code and gives agents 7 tools:

| Tool | What It Does |
|------|-------------|
| `context_search` | Hybrid keyword + semantic search across repo + global context |
| `context_auto_orient` | One-call orientation: index, preferences, recent sessions |
| `context_write` | Write entries with smart scope routing (preferences → global) |
| `context_read` | Read full content, repo-first with global fallback |
| `context_list` | Browse entries with `[repo]`/`[global]` provenance tags |
| `context_risk` | Assess modification risk — hotspots, hidden coupling, bus factor |
| `context_delete` | Remove stale knowledge |

```
Agent: "Let me orient myself in this project..."
→ context_auto_orient()
→ Returns: project overview, preferences, recent sessions, recent changes

Agent: "Let me search for context about the auth flow..."
→ context_search("authentication flow")
→ Auto-routes to facts/ category, returns compact results

Agent: "I found a race condition. Let me record this."
→ context_write(category="regressions", filename="token-refresh-race", content="...")
→ Persisted. Detects if it supersedes an existing entry.
```

Sessions are auto-captured on shutdown. Zero config — `repomemory setup claude` handles everything.

## Supported Tools

| Tool | Integration | API Key Required? |
|------|------------|-------------------|
| **Claude Code** | MCP server (auto-starts) + post-commit hook | Yes (for analysis) |
| **Cursor** | MCP server + rules + 6 slash commands | **No** — uses Cursor's built-in AI |
| **GitHub Copilot** | `copilot-instructions.md` | Yes (for analysis) |
| **Windsurf** | `.windsurfrules` | Yes (for analysis) |
| **Cline** | `.clinerules` | Yes (for analysis) |
| **Aider** | `.aider.conf.yml` | Yes (for analysis) |
| **Continue** | `.continue/rules/` | Yes (for analysis) |

> **Cursor users:** You don't need any API key. Run `npx repomemory setup cursor`, then use `/repomemory-analyze` in Cursor chat. Cursor's AI does the analysis using the MCP tools — whatever model Cursor is using (it can even switch models mid-task).

## Supported Providers

| Provider | Models | Env Variable |
|----------|--------|-------------|
| `anthropic` | claude-sonnet-4-6, claude-opus-4-6 | `ANTHROPIC_API_KEY` |
| `openai` | gpt-4o, o3-mini | `OPENAI_API_KEY` |
| `gemini` | gemini-2.0-flash, gemini-2.5-pro | `GEMINI_API_KEY` / `GOOGLE_API_KEY` |
| `grok` | grok-3, grok-3-mini | `GROK_API_KEY` / `XAI_API_KEY` |

**Embeddings** (optional, for semantic search): Gemini `text-embedding-004` (free, default) or OpenAI `text-embedding-3-small`. Auto-detected from available API keys.

## All Commands

```bash
repomemory go                            # One-command setup (add --yes for non-interactive)
repomemory wizard                        # Interactive guided setup
repomemory analyze                       # AI-powered repo analysis
repomemory analyze --merge               # Update without overwriting edits
repomemory analyze --dry-run             # Preview without API call
repomemory search <query>                # Search knowledge base from terminal
repomemory status                        # Coverage and freshness report
repomemory doctor                        # Diagnostics and health check
repomemory dashboard                     # Local web UI (localhost:3333)
repomemory risk                          # Hotspots, coupling, ownership analysis
repomemory risk -f src/auth.ts           # Targeted risk assessment for specific files
repomemory sync                          # Sync git history to changelog
repomemory setup <tool>                  # Configure Claude/Cursor/Copilot/etc
repomemory hook install                  # Auto-sync changelog on commits
repomemory global list                   # Manage global developer context
repomemory global export                 # Export global context as JSON
```

## Configuration

`.repomemory.json` in your repo root (all fields optional):

```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-6",
  "embeddingProvider": "gemini",
  "hybridAlpha": 0.5,
  "maxFilesForAnalysis": 80,
  "enableGlobalContext": true
}
```

Custom `ignorePatterns` and `keyFilePatterns` are **additive** — they extend built-in defaults, not replace them.

## Why Not Just CLAUDE.md?

| | CLAUDE.md | repomemory |
|--|-----------|------------|
| **Maintenance** | Manual | AI-generated + agent-maintained |
| **Search** | Load everything | Hybrid keyword + semantic |
| **Cross-tool** | Claude Code only | 7 tools supported |
| **Team knowledge** | One person writes | Every AI session contributes |
| **Decisions** | Mixed in with instructions | Structured, searchable |
| **Regressions** | Not tracked | Prevents repeat bugs |
| **Sessions** | Not tracked | Auto-captured on shutdown |
| **Freshness** | Unknown | Staleness detection + auto-purge |

repomemory doesn't replace `CLAUDE.md` — it complements it. `CLAUDE.md` is for instructions and rules. `.context/` holds the knowledge that grows over time.

## Contributing

See [CONTRIBUTING.md](.github/CONTRIBUTING.md) for development setup, testing, and contribution guidelines.

## License

MIT

---

<div align="center">

**Built for developers who are tired of AI agents forgetting everything between sessions.**

[Report Bug](https://github.com/DanielGuru/repomemory/issues) · [Request Feature](https://github.com/DanielGuru/repomemory/issues) · [npm](https://www.npmjs.com/package/repomemory)

</div>
