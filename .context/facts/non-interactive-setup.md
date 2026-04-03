# Non-Interactive Setup

Both `go` and `wizard` support deterministic, non-interactive execution for CI and scripting.

## Flags
- `--yes` / `--defaults` — use defaults, skip all prompts
- `--no-prompt` — fail instead of prompting (implied by `--yes`)
- `--provider <provider>` — explicit provider selection
- `--embedding-provider <provider>` — explicit embedding choice (including `none`)
- `--max-files <n>` — max files for analysis
- `--skip-analyze` — skip the AI analysis step
- `--tools <list>` — comma-separated tools (wizard only)

## TTY detection
`interactive = process.stdin.isTTY && process.stdout.isTTY && !noPrompt`

When non-interactive, prompts are bypassed with sensible defaults:
- Provider: first detected key, fallback to anthropic
- Embeddings: first available provider
- Max files: config default (80)
- Tools: claude only (wizard)

## Cursor-Only Mode (v1.10.0)
When no API keys are detected in the wizard, a "None — I use Cursor" option is offered. This:
- Sets `cursorOnlyMode = true`
- Replaces default tool selection `["claude"]` with `["cursor"]`
- Skips AI analysis (Cursor's own AI handles it via `/repomemory-analyze`)
- Skips embedding provider prompt
- Prints Cursor-specific next steps

## Auto-Detect in `go`
`go` command auto-detects `~/.cursor/` directory and runs `setupCommand("cursor")` alongside Claude Code setup (go.ts:225-248).

## Example
```bash
npx repomemory go --yes --provider anthropic --embedding-provider none --max-files 80 --skip-analyze
```