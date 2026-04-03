#!/usr/bin/env node

import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { analyzeCommand } from "./commands/analyze.js";
import { syncCommand } from "./commands/sync.js";
import { serveCommand } from "./commands/serve.js";
import { setupCommand } from "./commands/setup.js";
import { statusCommand } from "./commands/status.js";
import { wizardCommand } from "./commands/wizard.js";
import { dashboardCommand } from "./commands/dashboard.js";
import { hookCommand } from "./commands/hook.js";
import { goCommand } from "./commands/go.js";
import { searchCommand } from "./commands/search.js";
import { doctorCommand } from "./commands/doctor.js";
import { riskCommand } from "./commands/risk.js";
import {
  globalListCommand,
  globalReadCommand,
  globalWriteCommand,
  globalDeleteCommand,
  globalExportCommand,
  globalImportCommand,
} from "./commands/global.js";

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { version } = require("../package.json");

const program = new Command();

program
  .name("repomemory")
  .description("Your codebase never forgets. Persistent, structured memory for AI coding agents.")
  .version(version);

program
  .command("init")
  .description("Initialize .context/ directory in the current repo")
  .option("-d, --dir <path>", "Repository root directory", process.cwd())
  .option("-p, --provider <provider>", "AI provider (anthropic, openai, gemini, grok)")
  .option("-e, --embedding-provider <provider>", "Embedding provider for semantic search (openai, gemini)")
  .action(initCommand);

program
  .command("analyze")
  .description("Analyze the repository with AI and populate .context/ with structured knowledge")
  .option("-d, --dir <path>", "Repository root directory", process.cwd())
  .option("-p, --provider <provider>", "AI provider (anthropic, openai, gemini, grok)")
  .option("-m, --model <model>", "Model to use (provider-specific)")
  .option("-v, --verbose", "Show detailed output", false)
  .option("--dry-run", "Show what would be analyzed without calling the AI", false)
  .option("--merge", "Merge with existing context (don't overwrite manual edits)", false)
  .option("--incremental", "Only re-analyze files changed since last analysis", false)
  .action(analyzeCommand);

program
  .command("sync")
  .description("Sync recent git history into .context/changelog/")
  .option("-d, --dir <path>", "Repository root directory", process.cwd())
  .option("-s, --since <date>", "Sync commits since this date (YYYY-MM-DD)")
  .action(syncCommand);

program
  .command("serve")
  .description("Start the MCP server for AI agent integration")
  .option("-d, --dir <path>", "Repository root directory", process.cwd())
  .action(serveCommand);

program
  .command("setup <tool>")
  .description("Configure AI tool integration (claude, cursor, copilot, windsurf, cline, aider, continue)")
  .option("-d, --dir <path>", "Repository root directory", process.cwd())
  .action(setupCommand);

program
  .command("status")
  .description("Show the current state of .context/ with coverage and freshness")
  .option("-d, --dir <path>", "Repository root directory", process.cwd())
  .action(statusCommand);

program
  .command("search <query>")
  .description("Search the .context/ knowledge base from the terminal")
  .option("-d, --dir <path>", "Repository root directory", process.cwd())
  .option("-c, --category <category>", "Filter by category (facts, decisions, regressions, etc.)")
  .option("-l, --limit <n>", "Max results to return", "10")
  .option("--detail <level>", "Output detail: compact or full", "compact")
  .option("--explain", "Show keyword vs semantic score breakdown", false)
  .option("--json", "Output results as JSON", false)
  .action(searchCommand);

program
  .command("wizard")
  .description("Interactive guided setup — provider, tools, and first analysis in one flow")
  .option("-d, --dir <path>", "Repository root directory", process.cwd())
  .option("-y, --yes", "Use defaults and skip all prompts", false)
  .option("--defaults", "Alias for --yes", false)
  .option("--no-prompt", "Fail instead of prompting when input is required", false)
  .option("-p, --provider <provider>", "AI provider (anthropic, openai, gemini, grok)")
  .option("-e, --embedding-provider <provider>", "Embedding provider (openai, gemini, none)")
  .option("--max-files <n>", "Max files to analyze during setup", "80")
  .option("--tools <tools>", "Comma-separated tools to configure (claude,cursor,copilot,windsurf,cline,aider,continue)")
  .option("--skip-analyze", "Skip the analysis step", false)
  .action(wizardCommand);

program
  .command("dashboard")
  .description("Open a web dashboard to browse and search your context files")
  .option("-d, --dir <path>", "Repository root directory", process.cwd())
  .option("--port <port>", "Port to serve on", "3333")
  .action(dashboardCommand);

program
  .command("hook <action>")
  .description("Manage git hooks (install, uninstall) — auto-sync changelog on commits")
  .option("-d, --dir <path>", "Repository root directory", process.cwd())
  .action(hookCommand);

program
  .command("doctor")
  .description("Run diagnostics and output a support-friendly health report")
  .option("-d, --dir <path>", "Repository root directory", process.cwd())
  .option("--json", "Output machine-readable JSON", false)
  .option("--output <path>", "Write a diagnostics bundle to this file")
  .action(doctorCommand);

program
  .command("risk")
  .description("Analyze git history for hotspots, hidden coupling, and ownership risk")
  .option("-d, --dir <path>", "Repository root directory", process.cwd())
  .option("-f, --files <files>", "Comma-separated file paths to assess (e.g. src/auth.ts,src/api.ts)")
  .option("-l, --limit <n>", "Max results per category", "15")
  .option("--max-commits <n>", "Max git commits to analyze", "500")
  .option("--json", "Output results as JSON", false)
  .action(riskCommand);

program
  .command("go")
  .description("One-command setup — init, analyze, and configure Claude Code in one flow")
  .option("-d, --dir <path>", "Repository root directory", process.cwd())
  .option("-p, --provider <provider>", "AI provider (anthropic, openai, gemini, grok)")
  .option("-m, --model <model>", "Model to use (provider-specific)")
  .option("-e, --embedding-provider <provider>", "Embedding provider for semantic search (openai, gemini, none)")
  .option("--max-files <n>", "Max files to analyze", "80")
  .option("-y, --yes", "Use defaults and skip all prompts", false)
  .option("--defaults", "Alias for --yes", false)
  .option("--no-prompt", "Fail instead of prompting when input is required", false)
  .option("--skip-analyze", "Skip the analysis step", false)
  .action(goCommand);

const globalCmd = program.command("global").description("Manage global developer context (~/.repomemory/global/)");

globalCmd
  .command("list")
  .description("List all global context entries")
  .option("-c, --category <category>", "Filter by category")
  .action(globalListCommand);

globalCmd
  .command("read <entry>")
  .description("Read a global context entry (e.g. preferences/coding-style)")
  .action(globalReadCommand);

globalCmd
  .command("write <entry>")
  .description("Write a global context entry (e.g. preferences/coding-style)")
  .option("--content <content>", "Content to write")
  .action(globalWriteCommand);

globalCmd.command("delete <entry>").description("Delete a global context entry").action(globalDeleteCommand);

globalCmd.command("export").description("Export all global context as JSON to stdout").action(globalExportCommand);

globalCmd.command("import").description("Import global context from JSON on stdin").action(globalImportCommand);

// Global error handlers
process.on("uncaughtException", (err) => {
  const msg = err.message || String(err);

  if (msg.includes("API key")) {
    console.error(`\n\u2717 ${msg}`);
    console.error("\n  Set your API key and try again:");
    console.error("    export ANTHROPIC_API_KEY=sk-ant-...");
    console.error("    export OPENAI_API_KEY=sk-...");
    console.error("    export GEMINI_API_KEY=...");
    console.error("    export GROK_API_KEY=...");
  } else if (msg.includes("ENOENT")) {
    console.error(`\n\u2717 File or directory not found: ${msg.split("'")[1] || "unknown"}`);
  } else if (msg.includes("EACCES")) {
    console.error(`\n\u2717 Permission denied. Try running with appropriate permissions.`);
  } else if (msg.includes("fetch failed") || msg.includes("ECONNREFUSED")) {
    console.error(`\n\u2717 Network error. Check your internet connection and try again.`);
  } else if (msg.includes("401") || msg.includes("authentication")) {
    console.error(`\n\u2717 Authentication failed. Check your API key is valid.`);
  } else if (msg.includes("429") || msg.includes("rate limit")) {
    console.error(`\n\u2717 Rate limited. Wait a moment and try again.`);
  } else {
    console.error(`\n\u2717 ${msg}`);
  }

  if (process.env.REPOMEMORY_DEBUG) {
    console.error(err.stack || "");
  }
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  console.error(`\n\u2717 ${msg}`);
  if (process.env.REPOMEMORY_DEBUG && reason instanceof Error) {
    console.error(reason.stack || "");
  }
  process.exit(1);
});

program.parseAsync();
