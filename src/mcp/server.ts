import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ContextStore } from "../lib/context-store.js";
import type { ContextEntry } from "../lib/context-store.js";
import { SearchIndex, type SearchExplain } from "../lib/search.js";
import { createEmbeddingProvider } from "../lib/embeddings.js";
import type { RepoContextConfig } from "../lib/config.js";
import { resolveGlobalDir } from "../lib/config.js";
import { assessFileRisk, analyzeGitIntelligence } from "../lib/git-intelligence.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require("../../package.json");

const VALID_CATEGORIES = ["facts", "decisions", "regressions", "sessions", "changelog", "preferences"];

// --- Session Tracking ---

interface SessionTracker {
  startTime: Date;
  toolCalls: { tool: string; timestamp: Date }[];
  searchQueries: string[];
  entriesRead: string[];
  entriesWritten: string[];
  entriesDeleted: string[];
  writeCallMade: boolean;
  readCallCount: number;
}

function createSessionTracker(): SessionTracker {
  return {
    startTime: new Date(),
    toolCalls: [],
    searchQueries: [],
    entriesRead: [],
    entriesWritten: [],
    entriesDeleted: [],
    writeCallMade: false,
    readCallCount: 0,
  };
}

export function buildSessionSummary(session: SessionTracker, durationSeconds: number): string {
  const date = new Date().toISOString().split("T")[0];
  const mins = Math.round(durationSeconds / 60);
  const parts: string[] = [];

  parts.push(`## Auto-captured session ${date} (${mins}min)\n`);

  if (session.searchQueries.length > 0) {
    parts.push(`**Searched:** ${[...new Set(session.searchQueries)].join(", ")}`);
  }

  if (session.entriesRead.length > 0) {
    parts.push(`**Read:** ${[...new Set(session.entriesRead)].join(", ")}`);
  }

  if (session.entriesWritten.length > 0) {
    parts.push(`**Written:** ${[...new Set(session.entriesWritten)].join(", ")}`);
  }

  if (session.entriesDeleted.length > 0) {
    parts.push(`**Deleted:** ${[...new Set(session.entriesDeleted)].join(", ")}`);
  }

  parts.push(`**Total tool calls:** ${session.toolCalls.length}`);

  return parts.join("\n");
}

// --- Intelligent Category Routing ---

/**
 * Detect the most likely category for a search query using keyword heuristics.
 * Returns undefined if no category can be confidently inferred.
 *
 * Precedence order is intentional: decisions > regressions > preferences > sessions > facts.
 * For ambiguous queries (e.g., "why did the login crash"), decisions wins because
 * understanding the "why" is usually more actionable. The caller retries without
 * category filter if the routed search returns 0 results.
 */
const CATEGORY_PATTERNS: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /\b(why\b|chose|decision|alternatives?|trade.?off|instead of|reason\b)/, category: "decisions" },
  { pattern: /\b(bug|broke|regression|crash|error\b|fail|fix\b|issues?\b|problem|broken)/, category: "regressions" },
  {
    pattern:
      /\b(prefer(?:red|ence|s)?|coding style|naming convention|indent(?:ation)?|lint(?:ing)?|tab(?:s|\s+vs|\s+or)|code format(?:ting)?)/,
    category: "preferences",
  },
  { pattern: /\b(last session|previous session|yesterday|worked on|accomplished)/, category: "sessions" },
  { pattern: /\b(how does|how do|architecture|schema|database|api|endpoint|flow|structure)/, category: "facts" },
];

export function detectQueryCategory(query: string): string | undefined {
  const q = query.toLowerCase();
  for (const { pattern, category } of CATEGORY_PATTERNS) {
    if (pattern.test(q)) return category;
  }
  return undefined;
}

export async function startMcpServer(repoRoot: string, config: RepoContextConfig): Promise<void> {
  const store = new ContextStore(repoRoot, config);
  let searchIndex: SearchIndex | null = null;

  // Initialize embedding provider (optional — falls back to keyword search)
  let embeddingProvider = null;
  try {
    embeddingProvider = await createEmbeddingProvider({
      provider: config.embeddingProvider,
      model: config.embeddingModel,
      apiKey: config.embeddingApiKey,
    });
  } catch {
    // No embeddings available, will use keyword-only search
  }

  if (store.exists()) {
    try {
      searchIndex = new SearchIndex(store.path, store, embeddingProvider, config.hybridAlpha, config.maxEmbeddingChars);
      await searchIndex.rebuild();
    } catch (e) {
      console.error("Warning: Could not initialize search index:", e);
    }
  }

  // --- Global Context Store (v1.2) ---
  let globalStore: ContextStore | null = null;
  let globalSearchIndex: SearchIndex | null = null;

  if (config.enableGlobalContext) {
    try {
      const globalDir = resolveGlobalDir(config);
      globalStore = ContextStore.forAbsolutePath(globalDir);
      if (!globalStore.exists()) {
        globalStore.scaffold();
      }
      globalSearchIndex = new SearchIndex(
        globalStore.path,
        globalStore,
        embeddingProvider,
        config.hybridAlpha,
        config.maxEmbeddingChars
      );
      await globalSearchIndex.rebuild();
    } catch (e) {
      console.error("Warning: Could not initialize global context:", e);
      globalStore = null;
      globalSearchIndex = null;
    }
  }

  // --- Scope Helpers ---
  function resolveScope(category: string, explicitScope?: string): "repo" | "global" {
    if (explicitScope === "repo" || explicitScope === "global") return explicitScope;
    if (category === "preferences" && globalStore) return "global";
    return "repo";
  }

  function getStore(scope: "repo" | "global"): ContextStore {
    if (scope === "global" && globalStore) return globalStore;
    return store;
  }

  function getIndex(scope: "repo" | "global"): SearchIndex | null {
    if (scope === "global") return globalSearchIndex;
    return searchIndex;
  }

  const session = createSessionTracker();

  const server = new Server(
    {
      name: "repomemory",
      version: PKG_VERSION,
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    }
  );

  // --- Prompts ---

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [
      {
        name: "start-task",
        description:
          "Search for relevant context before starting a new task. Use this at the beginning of every coding session.",
        arguments: [
          {
            name: "task",
            description: "Brief description of what you're about to work on",
            required: true,
          },
        ],
      },
      {
        name: "end-session",
        description:
          "Record what you accomplished and discovered during this session. Routes conclusions to the right categories.",
        arguments: [
          {
            name: "summary",
            description: "What you worked on and any discoveries worth remembering",
            required: true,
          },
        ],
      },
    ],
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === "start-task") {
      const task = (args?.task as string) || "general work";
      return {
        description: `Find relevant context for: ${task}`,
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `I'm about to work on: ${task}\n\nYou MUST search the repository's persistent knowledge base for relevant context before starting. Use context_search with relevant keywords, and call context_auto_orient if this is a new session. Before modifying any files, call context_risk with the file paths you plan to change — it reveals hidden coupling, ownership concentration, and churn hotspots. Do NOT skip these steps.`,
            },
          },
        ],
      };
    }

    if (name === "end-session") {
      const summary = (args?.summary as string) || "session work";
      return {
        description: "Record session discoveries",
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `Session summary: ${summary}\n\nPlease record this session's work. IMPORTANT: Route knowledge to the RIGHT categories:\n- New architectural facts \u2192 context_write(category="facts", ...)\n- Decisions made \u2192 context_write(category="decisions", ...)\n- Bugs/regressions found \u2192 context_write(category="regressions", ...)\n- Coding style preferences \u2192 context_write(category="preferences", ...)\n- The session overview itself \u2192 context_write(category="sessions", ...)\n\nDo NOT dump everything into sessions/. Parse your conclusions and write each piece to the appropriate category.`,
            },
          },
        ],
      };
    }

    throw new Error(`Unknown prompt: ${name}`);
  });

  // --- Tools ---

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "context_search",
          description:
            "Search the repository's persistent knowledge base. Returns relevant facts, decisions, regressions, and session notes. Use this FIRST at the start of every task to find relevant context, or when you need to understand why something is the way it is. This prevents re-discovering architecture and re-debating past decisions.",
          inputSchema: {
            type: "object" as const,
            properties: {
              query: {
                type: "string",
                description:
                  "Natural language search query. Examples: 'authentication flow', 'why we chose Drizzle', 'database schema', 'known issues with deployment'",
              },
              category: {
                type: "string",
                enum: VALID_CATEGORIES,
                description: "Optional: filter results to a specific category. Omit to search all.",
              },
              limit: {
                type: "number",
                description: "Max results to return (default: 5)",
              },
              detail: {
                type: "string",
                enum: ["compact", "full"],
                description:
                  "Level of detail. 'compact' (default) returns one-line summaries (~50 tokens each). 'full' returns longer snippets.",
              },
              scope: {
                type: "string",
                enum: ["repo", "global"],
                description: "Optional: search only repo or only global context. Omit to search both.",
              },
              explain: {
                type: "boolean",
                description:
                  "Optional: include score breakdown (keyword vs semantic vs hybrid) in results. Useful for debugging search quality.",
              },
            },
            required: ["query"],
          },
          annotations: {
            title: "Search Context",
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
        },
        {
          name: "context_write",
          description:
            "Write a new piece of knowledge to the repository's persistent memory. Use this to record: discoveries you made during this session, architectural decisions, bug patterns, or any insight that would help a future AI session. This persists across sessions \u2014 write anything you'd want a future version of yourself to know.",
          inputSchema: {
            type: "object" as const,
            properties: {
              category: {
                type: "string",
                enum: VALID_CATEGORIES,
                description: `Category for the knowledge:\n- facts: Architecture, patterns, how things work\n- decisions: Why something was chosen (include alternatives considered)\n- regressions: Bug patterns, things that broke, gotchas\n- sessions: What you worked on and discovered this session\n- changelog: Notable changes\n- preferences: Coding style, preferred patterns, tool configs, formatting rules \u2014 personal developer knowledge`,
              },
              filename: {
                type: "string",
                description:
                  "Descriptive filename (without .md extension). Use kebab-case. Examples: 'auth-flow', 'why-drizzle-orm', 'token-refresh-race-condition'",
              },
              content: {
                type: "string",
                description:
                  "Markdown content to write. Be specific: include file paths, function names, commands. Every line should inform a decision.",
              },
              append: {
                type: "boolean",
                description: "If true, append to existing file instead of overwriting. Useful for session logs.",
              },
              supersedes: {
                type: "string",
                description:
                  "Filename of an existing entry in the same category that this replaces. The old entry will be auto-deleted.",
              },
              scope: {
                type: "string",
                enum: ["repo", "global"],
                description:
                  "Where to store. Defaults: preferences\u2192global, everything else\u2192repo. Explicit override.",
              },
            },
            required: ["category", "filename", "content"],
          },
          annotations: {
            title: "Write Context",
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: false,
          },
        },
        {
          name: "context_delete",
          description:
            "Delete a knowledge entry from the repository context. Use this to remove stale or incorrect information. Knowledge quality matters more than quantity \u2014 prune aggressively.",
          inputSchema: {
            type: "object" as const,
            properties: {
              category: {
                type: "string",
                enum: VALID_CATEGORIES,
                description: "The category of the entry to delete.",
              },
              filename: {
                type: "string",
                description: "The filename to delete (with or without .md extension).",
              },
              scope: {
                type: "string",
                enum: ["repo", "global"],
                description: "Which layer to delete from. Defaults to repo, falls back to global if not found.",
              },
            },
            required: ["category", "filename"],
          },
          annotations: {
            title: "Delete Context",
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: true,
            openWorldHint: false,
          },
        },
        {
          name: "context_list",
          description:
            "List all knowledge entries in the repository context, optionally filtered by category. Returns filenames, titles, and age for browsing. Use this to understand what knowledge already exists before writing new entries.",
          inputSchema: {
            type: "object" as const,
            properties: {
              category: {
                type: "string",
                enum: VALID_CATEGORIES,
                description: "Optional: filter to a specific category.",
              },
              compact: {
                type: "boolean",
                description: "If true (default), returns one-line summaries. If false, includes file sizes.",
              },
              scope: {
                type: "string",
                enum: ["repo", "global"],
                description: "Optional: list only repo or only global context. Omit to list both.",
              },
            },
          },
          annotations: {
            title: "List Context",
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
        },
        {
          name: "context_read",
          description:
            "Read the full content of a specific context file. Use after context_search or context_list to get complete details.",
          inputSchema: {
            type: "object" as const,
            properties: {
              category: {
                type: "string",
                enum: VALID_CATEGORIES,
                description: "The category (facts, decisions, regressions, sessions, changelog, preferences)",
              },
              filename: {
                type: "string",
                description: "The filename to read (with or without .md extension)",
              },
              scope: {
                type: "string",
                enum: ["repo", "global"],
                description: "Which layer to read from. Defaults to repo, falls back to global if not found.",
              },
            },
            required: ["category", "filename"],
          },
          annotations: {
            title: "Read Context",
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
        },
        {
          name: "context_auto_orient",
          description:
            "Get a comprehensive project orientation in a single call. Returns the project index, recent session summaries, and recently modified entries. Use this at the START of every new coding session to immediately understand the project. This replaces the need to make 3-4 separate tool calls.",
          inputSchema: {
            type: "object" as const,
            properties: {},
          },
          annotations: {
            title: "Auto Orient",
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
        },
        {
          name: "context_risk",
          description:
            "Assess modification risk for files BEFORE editing them. Analyzes git history to surface: hotspot files (high churn), hidden coupling (files that always change together), ownership concentration (bus factor). Use this when you're about to modify important files to understand what else might need to change and what risks to watch for.",
          inputSchema: {
            type: "object" as const,
            properties: {
              targets: {
                type: "array",
                items: { type: "string" },
                description:
                  "File paths to assess (relative to repo root). Example: ['src/lib/auth.ts', 'src/api/routes.ts']. If omitted, returns global hotspot overview.",
              },
              maxCommits: {
                type: "number",
                description: "Max git commits to analyze (default: 500). Lower = faster, higher = more accurate.",
              },
            },
          },
          annotations: {
            title: "Risk Assessment",
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // Track every tool call for session capture
    session.toolCalls.push({ tool: name, timestamp: new Date() });

    // Build write-nudge suffix for non-writing sessions
    const getWriteNudge = (): string => {
      if (!session.writeCallMade && session.readCallCount >= 3) {
        return "\n\n> Tip: Use `context_write` to record any discoveries or decisions from this session.";
      }
      return "";
    };

    switch (name) {
      case "context_search": {
        const {
          query,
          category,
          limit = 5,
          detail = "compact",
          scope: explicitScope,
          explain: wantExplain = false,
        } = args as {
          query: string;
          category?: string;
          limit?: number;
          detail?: "compact" | "full";
          scope?: "repo" | "global";
          explain?: boolean;
        };

        session.searchQueries.push(query);
        session.readCallCount++;

        // Guard: empty query
        if (!query || !query.trim()) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Empty search query. Use context_list to browse all entries, or provide a search term.",
              },
            ],
          };
        }

        // Validate category if provided
        if (category && !VALID_CATEGORIES.includes(category)) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Invalid category: ${category}. Valid categories: ${VALID_CATEGORIES.join(", ")}`,
              },
            ],
            isError: true,
          };
        }

        const repoExists = store.exists();
        const globalExists = globalStore?.exists();

        if (!repoExists && !globalExists) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No .context/ directory found. Tell the user to run:\n\n  npx repomemory go\n\nThis will set up persistent memory for this project.",
              },
            ],
          };
        }

        // Lazy-init repo search index
        if (repoExists && !searchIndex) {
          searchIndex = new SearchIndex(
            store.path,
            store,
            embeddingProvider,
            config.hybridAlpha,
            config.maxEmbeddingChars
          );
          await searchIndex.rebuild();
        }

        // Lazy-init global search index
        if (globalExists && globalStore && !globalSearchIndex) {
          globalSearchIndex = new SearchIndex(
            globalStore.path,
            globalStore,
            embeddingProvider,
            config.hybridAlpha,
            config.maxEmbeddingChars
          );
          await globalSearchIndex.rebuild();
        }

        // Intelligent category routing: auto-detect if not explicitly provided
        let effectiveCategory = category;
        let routingNote = "";
        if (!category) {
          const detected = detectQueryCategory(query);
          if (detected) {
            effectiveCategory = detected;
            routingNote = `(auto-routed to ${detected}/) `;
          }
        }

        // Search repo
        type TaggedResult = {
          category: string;
          filename: string;
          title: string;
          snippet: string;
          score: number;
          relativePath: string;
          source: string;
          explain?: SearchExplain;
        };
        let repoResults: TaggedResult[] = [];
        if ((!explicitScope || explicitScope === "repo") && searchIndex) {
          const raw = await searchIndex.search(query, effectiveCategory, limit, wantExplain);
          repoResults = raw.map((r) => ({ ...r, source: "repo" }));

          // If routing returned 0, retry without category filter
          if (repoResults.length === 0 && effectiveCategory && !category) {
            const retry = await searchIndex.search(query, undefined, limit, wantExplain);
            repoResults = retry.map((r) => ({ ...r, source: "repo" }));
            routingNote = "";
          }
        }

        // Search global
        let globalResults: TaggedResult[] = [];
        if ((!explicitScope || explicitScope === "global") && globalSearchIndex) {
          const raw = await globalSearchIndex.search(query, effectiveCategory, limit, wantExplain);
          globalResults = raw.map((r) => ({ ...r, source: "global" }));

          if (globalResults.length === 0 && effectiveCategory && !category) {
            const retry = await globalSearchIndex.search(query, undefined, limit, wantExplain);
            globalResults = retry.map((r) => ({ ...r, source: "global" }));
          }
        }

        // Merge: repo-first dedup by category/filename
        const seen = new Set<string>();
        const merged: TaggedResult[] = [];
        for (const r of repoResults) {
          const key = `${r.category}/${r.filename}`;
          if (!seen.has(key)) {
            seen.add(key);
            merged.push(r);
          }
        }
        for (const r of globalResults) {
          const key = `${r.category}/${r.filename}`;
          if (!seen.has(key)) {
            seen.add(key);
            merged.push(r);
          }
        }
        merged.sort((a, b) => b.score - a.score);
        const results = merged.slice(0, limit);

        if (results.length === 0) {
          // Fallback to simple text search across both stores
          const queryLower = query.toLowerCase();
          const fallbackEntries: TaggedResult[] = [];

          const searchStore = (s: ContextStore, source: string) => {
            if (!s.exists()) return;
            const entries = s.listEntries(category);
            for (const e of entries) {
              if (
                e.content.toLowerCase().includes(queryLower) ||
                e.title.toLowerCase().includes(queryLower) ||
                e.category.toLowerCase().includes(queryLower) ||
                e.filename.replace(/\.md$/, "").replace(/-/g, " ").toLowerCase().includes(queryLower)
              ) {
                fallbackEntries.push({ ...e, snippet: e.content, score: 0, source });
              }
            }
          };

          if (!explicitScope || explicitScope === "repo") searchStore(store, "repo");
          if ((!explicitScope || explicitScope === "global") && globalStore) searchStore(globalStore, "global");

          // Dedup and limit
          const seenFallback = new Set<string>();
          const matched = fallbackEntries
            .filter((e) => {
              const key = `${e.category}/${e.filename}`;
              if (seenFallback.has(key)) return false;
              seenFallback.add(key);
              return true;
            })
            .slice(0, limit);

          if (matched.length === 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `No results found for "${query}"${category ? ` in ${category}` : ""}. Try a different query or browse with context_list.${getWriteNudge()}`,
                },
              ],
            };
          }

          let text: string;
          const sourceTag = (s: string) => (globalStore ? ` \u2014 ${s}` : "");
          if (detail === "compact") {
            text =
              routingNote +
              matched
                .map(
                  (e) =>
                    `- **${e.title}** [${e.category}/${e.filename}${sourceTag(e.source)}] \u2014 ${e.snippet.slice(0, 150).replace(/\n/g, " ")}...`
                )
                .join("\n");
          } else {
            text =
              routingNote +
              matched
                .map(
                  (e) =>
                    `## ${e.category}/${e.filename}${sourceTag(e.source)}\n**${e.title}**\n\n${e.snippet.slice(0, 800)}\n`
                )
                .join("\n---\n\n");
          }
          return { content: [{ type: "text" as const, text: text + getWriteNudge() }] };
        }

        // Format search results with source tags when global is active
        const sourceTag = (s: string) => (globalStore ? ` \u2014 ${s}` : "");
        const explainTag = (r: (typeof results)[0]) => {
          if (!wantExplain || !r.explain) return "";
          const e = r.explain;
          return ` [${e.method}: kw=${e.keywordScore.toFixed(2)} sem=${e.semanticScore.toFixed(2)}]`;
        };
        let text: string;
        if (detail === "compact") {
          text =
            routingNote +
            results
              .map(
                (r) =>
                  `- **${r.title}** [${r.category}/${r.filename}${sourceTag(r.source)}] (score: ${r.score.toFixed(2)})${explainTag(r)} \u2014 ${r.snippet.slice(0, 150).replace(/\n/g, " ")}...`
              )
              .join("\n");
        } else {
          text =
            routingNote +
            results
              .map(
                (r) =>
                  `## ${r.category}/${r.filename}${sourceTag(r.source)} (relevance: ${r.score.toFixed(2)})${explainTag(r)}\n**${r.title}**\n\n${r.snippet}\n`
              )
              .join("\n---\n\n");
        }

        return { content: [{ type: "text" as const, text: text + getWriteNudge() }] };
      }

      case "context_write": {
        const {
          category,
          filename,
          content,
          append = false,
          supersedes,
          scope: explicitScope,
        } = args as {
          category: string;
          filename: string;
          content: string;
          append?: boolean;
          supersedes?: string;
          scope?: "repo" | "global";
        };

        session.writeCallMade = true;
        session.entriesWritten.push(`${category}/${filename}`);

        // Validate category
        if (!VALID_CATEGORIES.includes(category)) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Invalid category: ${category}. Valid categories: ${VALID_CATEGORIES.join(", ")}`,
              },
            ],
            isError: true,
          };
        }

        // Resolve target scope
        const targetScope = resolveScope(category, explicitScope);
        const targetStore = getStore(targetScope);
        const targetIndex = getIndex(targetScope);

        if (!targetStore.exists()) {
          targetStore.scaffold();
        }

        // Auto-purge: handle explicit supersedes
        let supersedesDeleted = false;
        if (supersedes) {
          const supersedeFname = supersedes.endsWith(".md") ? supersedes : supersedes + ".md";
          supersedesDeleted = targetStore.deleteEntry(category, supersedeFname);
          if (supersedesDeleted && targetIndex) {
            await targetIndex.removeEntry(category, supersedeFname);
          }
        }

        // Auto-purge: detect potentially overlapping entries
        let supersededList: string[] = [];
        const searchTerms = filename.replace(/-/g, " ");
        const meaningfulWords = searchTerms.split(/\s+/).filter((t: string) => t.length > 1);
        if (!append && targetIndex && content.length >= 100 && meaningfulWords.length >= 2) {
          try {
            const existing = await targetIndex.search(searchTerms, category, 3);
            const maxScore = existing.length > 0 ? Math.max(...existing.map((r) => r.score)) : 0;
            supersededList = existing
              .filter(
                (r) =>
                  r.category === category &&
                  r.filename !== filename + ".md" &&
                  r.filename !== filename &&
                  r.score > maxScore * 0.3
              )
              .map((d) => `${d.category}/${d.filename} (score: ${d.score.toFixed(1)})`);
          } catch {
            // Best-effort overlap detection
          }
        }

        let relativePath: string;
        if (append) {
          relativePath = targetStore.appendEntry(category, filename, content);
        } else {
          relativePath = targetStore.writeEntry(category, filename, content);
        }

        // Incremental index update (not full rebuild)
        // Use actual filesystem entry to get correct mtime (avoids embedding churn on rebuild)
        if (targetIndex) {
          const entries = targetStore.listEntries(category);
          const actualEntry = entries.find((e) => e.relativePath === relativePath);
          if (actualEntry) {
            await targetIndex.indexEntry(actualEntry);
          }
        }

        const scopeTag = globalStore ? ` [${targetScope}]` : "";
        let responseText = `\u2713 Written to ${relativePath}${scopeTag}${append ? " (appended)" : ""}.`;

        if (supersedes && supersedesDeleted) {
          responseText += `\n\u2713 Superseded and deleted: ${category}/${supersedes}`;
        } else if (supersedes && !supersedesDeleted) {
          responseText += `\n\u26a0 Could not find ${category}/${supersedes} to supersede (file not found).`;
        }

        if (supersededList.length > 0) {
          responseText += `\n\u26a0 Potentially supersedes: ${supersededList.join(", ")}\n  Consider deleting old entries with context_delete if they're now outdated.`;
        }

        return {
          content: [
            {
              type: "text" as const,
              text: responseText,
            },
          ],
        };
      }

      case "context_delete": {
        const {
          category,
          filename,
          scope: explicitScope,
        } = args as {
          category: string;
          filename: string;
          scope?: "repo" | "global";
        };

        if (!VALID_CATEGORIES.includes(category)) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Invalid category: ${category}. Valid categories: ${VALID_CATEGORIES.join(", ")}`,
              },
            ],
            isError: true,
          };
        }

        session.entriesDeleted.push(`${category}/${filename}`);

        const fname = filename.endsWith(".md") ? filename : filename + ".md";
        const defaultScope = resolveScope(category, explicitScope);

        // Try the default scope first (matches context_write routing)
        let deleted = false;
        let deleteScope: "repo" | "global" = defaultScope;

        const primaryStore = getStore(defaultScope);
        deleted = primaryStore.deleteEntry(category, fname);

        // Fall back to the other scope if not found and no explicit scope
        if (!deleted && !explicitScope) {
          const fallbackScope = defaultScope === "repo" ? "global" : "repo";
          const fallbackStore = fallbackScope === "global" ? globalStore : store;
          if (fallbackStore) {
            deleted = fallbackStore.deleteEntry(category, fname);
            deleteScope = fallbackScope;
          }
        }

        if (!deleted) {
          return {
            content: [
              {
                type: "text" as const,
                text: `File not found: ${category}/${fname}. Use context_list to see available files.`,
              },
            ],
          };
        }

        // Remove from the correct search index
        const deleteIndex = deleteScope === "global" ? globalSearchIndex : searchIndex;
        if (deleteIndex) {
          await deleteIndex.removeEntry(category, fname);
        }

        const scopeTag = globalStore ? ` [${deleteScope}]` : "";
        return {
          content: [
            {
              type: "text" as const,
              text: `\u2713 Deleted ${category}/${fname}${scopeTag}. Stale knowledge removed.`,
            },
          ],
        };
      }

      case "context_list": {
        const {
          category,
          compact = true,
          scope: explicitScope,
        } = (args || {}) as {
          category?: string;
          compact?: boolean;
          scope?: "repo" | "global";
        };

        session.readCallCount++;

        if (category && !VALID_CATEGORIES.includes(category)) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Invalid category: ${category}. Valid categories: ${VALID_CATEGORIES.join(", ")}`,
              },
            ],
            isError: true,
          };
        }

        const repoExists = store.exists();
        const globalExists = globalStore?.exists();

        if (!repoExists && !globalExists) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No .context/ directory found. Run `npx repomemory go` to set up.",
              },
            ],
          };
        }

        // Collect entries from both stores
        type TaggedEntry = ContextEntry & { source: string };
        const allEntries: TaggedEntry[] = [];

        if ((!explicitScope || explicitScope === "repo") && repoExists) {
          allEntries.push(...store.listEntries(category).map((e) => ({ ...e, source: "repo" })));
        }
        if ((!explicitScope || explicitScope === "global") && globalExists && globalStore) {
          allEntries.push(...globalStore.listEntries(category).map((e) => ({ ...e, source: "global" })));
        }

        if (allEntries.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No entries found${category ? ` in ${category}` : ""}. Run \`npx repomemory analyze\` to populate, or use context_write to add entries.`,
              },
            ],
          };
        }

        const grouped: Record<string, TaggedEntry[]> = {};
        for (const entry of allEntries) {
          if (!grouped[entry.category]) grouped[entry.category] = [];
          grouped[entry.category].push(entry);
        }

        let text = "";
        const sourceTag = (s: string) => (globalStore ? ` [${s}]` : "");
        if (compact) {
          for (const [cat, catEntries] of Object.entries(grouped)) {
            text += `**${cat}/** (${catEntries.length})\n`;
            for (const entry of catEntries) {
              const age = getRelativeTime(entry.lastModified);
              text += `- ${entry.filename}${sourceTag(entry.source)} \u2014 ${entry.title} (${age})\n`;
            }
          }
        } else {
          text = "# Repository Context\n\n";
          for (const [cat, catEntries] of Object.entries(grouped)) {
            text += `## ${cat}/\n`;
            for (const entry of catEntries) {
              const sizeKb = (entry.sizeBytes / 1024).toFixed(1);
              const age = getRelativeTime(entry.lastModified);
              text += `- **${entry.filename}**${sourceTag(entry.source)} \u2014 ${entry.title} (${sizeKb}KB, ${age})\n`;
            }
            text += "\n";
          }
        }

        return { content: [{ type: "text" as const, text: text.trimEnd() + getWriteNudge() }] };
      }

      case "context_read": {
        const {
          category,
          filename,
          scope: explicitScope,
        } = args as {
          category: string;
          filename: string;
          scope?: "repo" | "global";
        };

        if (!category || !VALID_CATEGORIES.includes(category)) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Invalid category: ${category || "(empty)"}. Valid categories: ${VALID_CATEGORIES.join(", ")}`,
              },
            ],
            isError: true,
          };
        }

        session.entriesRead.push(`${category}/${filename}`);
        session.readCallCount++;

        const fname = filename.endsWith(".md") ? filename : filename + ".md";

        // Try repo first, fall back to global
        let content: string | null = null;
        let readScope = "repo";

        if (!explicitScope || explicitScope === "repo") {
          content = store.readEntry(category, fname);
        }
        if (!content && (!explicitScope || explicitScope === "global") && globalStore) {
          content = globalStore.readEntry(category, fname);
          readScope = "global";
        }

        if (!content) {
          return {
            content: [
              {
                type: "text" as const,
                text: `File not found: ${category}/${fname}. Use context_list to see available files.`,
              },
            ],
          };
        }

        const scopeTag = globalStore ? ` [${readScope}]` : "";
        return {
          content: [
            {
              type: "text" as const,
              text: `# ${category}/${fname}${scopeTag}\n\n${content}`,
            },
          ],
        };
      }

      case "context_auto_orient": {
        const repoExists = store.exists();
        const globalExists = globalStore?.exists();

        if (!repoExists && !globalExists) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No context found. The user needs to run:\n\n  npx repomemory go\n\nThis will set up persistent memory for this project.",
              },
            ],
          };
        }

        const parts: string[] = [];

        // 1. Index.md content (repo only)
        if (repoExists) {
          const indexContent = store.readIndex();
          if (indexContent && indexContent.trim().length > 0) {
            parts.push("# Project Overview\n\n" + indexContent);
          } else {
            parts.push("# Project Overview\n\n*No index.md found. Run `npx repomemory analyze` to generate.*");
          }
        } else {
          parts.push("# Project Overview\n\n*No .context/ found. Run `npx repomemory go` to set up.*");
        }

        // 2. Developer preferences (repo overrides + global)
        const repoPrefEntries = repoExists ? store.listEntries("preferences") : [];
        const globalPrefEntries = globalExists && globalStore ? globalStore.listEntries("preferences") : [];

        if (repoPrefEntries.length > 0 || globalPrefEntries.length > 0) {
          parts.push("\n# Developer Preferences\n");

          // Repo-level overrides first
          const seen = new Set<string>();
          for (const p of repoPrefEntries) {
            seen.add(p.filename);
            const tag = globalStore ? " [repo override]" : "";
            parts.push(`**${p.title}**${tag}\n${p.content.slice(0, 300)}\n`);
          }
          // Global preferences (skip if shadowed by repo)
          for (const p of globalPrefEntries) {
            if (!seen.has(p.filename)) {
              parts.push(`**${p.title}** [global]\n${p.content.slice(0, 300)}\n`);
            }
          }
        }

        // 3. Recent session summaries (last 3, repo only)
        if (repoExists) {
          const sessionEntries = store.listEntries("sessions");
          const recentSessions = sessionEntries
            .sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime())
            .slice(0, 3);

          if (recentSessions.length > 0) {
            parts.push("\n# Recent Sessions\n");
            for (const s of recentSessions) {
              const age = getRelativeTime(s.lastModified);
              parts.push(`- **${s.title}** (${age}) \u2014 ${s.content.slice(0, 200).replace(/\n/g, " ")}...`);
            }
          }
        }

        // 4. Recently modified entries (last 7 days, excluding sessions/changelog)
        if (repoExists) {
          const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
          const allEntries = store.listEntries();
          const recentEntries = allEntries
            .filter(
              (e) =>
                e.category !== "sessions" &&
                e.category !== "changelog" &&
                e.category !== "root" &&
                e.lastModified.getTime() > sevenDaysAgo
            )
            .sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime())
            .slice(0, 10);

          if (recentEntries.length > 0) {
            parts.push("\n# Recently Updated\n");
            for (const e of recentEntries) {
              parts.push(`- ${e.category}/${e.filename}: ${e.title} (${getRelativeTime(e.lastModified)})`);
            }
          }

          // 5. Stale entries warning (untouched for 30+ days)
          const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
          const staleEntries = allEntries
            .filter(
              (e) =>
                e.category !== "sessions" &&
                e.category !== "changelog" &&
                e.category !== "root" &&
                e.lastModified.getTime() < thirtyDaysAgo
            )
            .sort((a, b) => a.lastModified.getTime() - b.lastModified.getTime())
            .slice(0, 10);

          if (staleEntries.length > 0) {
            parts.push("\n# Potentially Stale Entries\n");
            parts.push(
              "> These entries haven't been updated in 30+ days. They may still be accurate — verify before relying on them.\n"
            );
            for (const e of staleEntries) {
              parts.push(`- ${e.category}/${e.filename}: ${e.title} (${getRelativeTime(e.lastModified)})`);
            }
          }

          // 6. Empty state warning
          const stats = store.getStats();
          if (stats.totalFiles === 0 || (stats.categories["facts"] || 0) === 0) {
            parts.push(
              "\n> **Note**: Context is mostly empty. Ask the user to run `npx repomemory analyze` to populate with architecture knowledge."
            );
          }
        }

        // 7. Top risk hotspots (quick git intelligence)
        try {
          const intel = analyzeGitIntelligence(repoRoot, { maxCommits: 200, topN: 5 });
          if (intel.hotspots.length > 0) {
            parts.push("\n# Risk Hotspots (high-churn files — use `context_risk` before modifying)\n");
            for (const h of intel.hotspots.slice(0, 5)) {
              const level = h.score >= 0.7 ? "\u26a0\ufe0f" : h.score >= 0.4 ? "\u26a1" : "";
              parts.push(`- ${level} ${h.file} — score: ${h.score}, ${h.commits} commits, ${h.churn} lines churned`);
            }
          }
        } catch {
          // Git intelligence is best-effort in orient
        }

        session.readCallCount++;
        return { content: [{ type: "text" as const, text: parts.join("\n") + getWriteNudge() }] };
      }

      case "context_risk": {
        const { targets, maxCommits = 500 } = (args || {}) as {
          targets?: string[];
          maxCommits?: number;
        };

        session.toolCalls.push({ tool: "context_risk", timestamp: new Date() });
        session.readCallCount++;

        const parts: string[] = [];

        if (targets && targets.length > 0) {
          // Targeted risk assessment
          const result = assessFileRisk(repoRoot, targets, { maxCommits });

          parts.push(
            `# Risk Assessment (${result.globalHotspots.length > 0 ? "from " + maxCommits + " commits" : "no git history"})\n`
          );

          for (const a of result.assessments) {
            const icon = a.riskLevel === "high" ? "\u26a0\ufe0f" : a.riskLevel === "medium" ? "\u26a1" : "\u2705";
            parts.push(`## ${icon} ${a.file} — ${a.riskLevel} risk`);

            if (a.riskFactors.length > 0) {
              for (const f of a.riskFactors) {
                parts.push(`- ${f}`);
              }
            } else {
              parts.push("- No significant risk factors detected");
            }

            if (a.ownership) {
              parts.push(
                `- **Owner:** ${a.ownership.primaryOwner} (${a.ownership.ownershipPct}%), bus factor: ${a.ownership.busFactor}`
              );
            }

            if (a.coChangePartners.length > 0) {
              parts.push("- **Often changes with:**");
              for (const c of a.coChangePartners) {
                const partner = c.fileA === a.file ? c.fileB : c.fileA;
                parts.push(`  - ${partner} (${c.coChangeCount} co-changes, confidence: ${c.confidence})`);
              }
            }
            parts.push("");
          }

          // Add global hotspots for context
          if (result.globalHotspots.length > 0) {
            parts.push("## Top Hotspots (for context)\n");
            for (const h of result.globalHotspots) {
              parts.push(`- ${h.file} — score: ${h.score}, ${h.commits} commits, ${h.churn} lines churned`);
            }
          }
        } else {
          // Global overview mode
          const intel = analyzeGitIntelligence(repoRoot, { maxCommits, topN: 15 });

          if (intel.analyzedCommits === 0) {
            return {
              content: [{ type: "text" as const, text: "No git history found. Is this a git repository?" }],
            };
          }

          parts.push(`# Git Intelligence Overview (${intel.analyzedCommits} commits over ${intel.timespan})\n`);

          if (intel.hotspots.length > 0) {
            parts.push("## Hotspot Files (high churn — modify with care)\n");
            for (const h of intel.hotspots.slice(0, 10)) {
              parts.push(
                `- **${h.file}** — score: ${h.score}, ${h.commits} commits, ${h.churn} lines churned, ${h.authors} authors`
              );
            }
            parts.push("");
          }

          if (intel.coChangePairs.length > 0) {
            parts.push("## Hidden Coupling (files that change together)\n");
            for (const c of intel.coChangePairs.slice(0, 10)) {
              parts.push(
                `- ${c.fileA} \u2194 ${c.fileB} — ${c.coChangeCount} co-changes (confidence: ${c.confidence})`
              );
            }
            parts.push("");
          }

          if (intel.ownership.length > 0) {
            parts.push("## Ownership Concentration\n");
            for (const o of intel.ownership) {
              const risk = o.busFactor === 1 ? " \u26a0\ufe0f bus-factor risk" : "";
              parts.push(`- **${o.file}** — ${o.primaryOwner} (${o.ownershipPct}%), bus factor: ${o.busFactor}${risk}`);
            }
          }
        }

        return { content: [{ type: "text" as const, text: parts.join("\n") + getWriteNudge() }] };
      }

      default:
        return {
          content: [
            {
              type: "text" as const,
              text: `Unknown tool: ${name}`,
            },
          ],
          isError: true,
        };
    }
  });

  // --- Resources ---

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const resources: Array<{ uri: string; name: string; description: string; mimeType: string }> = [];

    if (store.exists()) {
      for (const entry of store.listEntries()) {
        // Skip root entries (e.g. index.md) — they aren't readable via ReadResource
        if (!VALID_CATEGORIES.includes(entry.category)) continue;
        resources.push({
          uri: `repomemory://${entry.category}/${entry.filename}`,
          name: `${entry.category}/${entry.filename}`,
          description: entry.title,
          mimeType: "text/markdown",
        });
      }
    }

    if (globalStore?.exists()) {
      for (const entry of globalStore.listEntries()) {
        if (!VALID_CATEGORIES.includes(entry.category)) continue;
        resources.push({
          uri: `repomemory-global://${entry.category}/${entry.filename}`,
          name: `[global] ${entry.category}/${entry.filename}`,
          description: entry.title,
          mimeType: "text/markdown",
        });
      }
    }

    return { resources };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;
    const repoMatch = uri.match(/^repomemory:\/\/([^/]+)\/(.+)$/);
    const globalMatch = uri.match(/^repomemory-global:\/\/([^/]+)\/(.+)$/);
    const match = repoMatch || globalMatch;
    const isGlobal = !!globalMatch;

    if (!match) {
      throw new Error(`Invalid URI: ${uri}`);
    }

    const [, category, filename] = match;

    // Validate category to prevent path traversal
    if (!VALID_CATEGORIES.includes(category)) {
      throw new Error(`Invalid category in URI: ${category}`);
    }

    const targetStore = isGlobal && globalStore ? globalStore : store;
    const content = targetStore.readEntry(category, filename);

    if (!content) {
      throw new Error(`Resource not found: ${uri}`);
    }

    return {
      contents: [
        {
          uri,
          mimeType: "text/markdown",
          text: content,
        },
      ],
    };
  });

  // --- Graceful shutdown with auto-session capture ---

  let cleanupDone = false;
  const cleanup = () => {
    if (cleanupDone) return;
    cleanupDone = true;

    // Auto-write session summary if there was meaningful activity
    const duration = Math.round((Date.now() - session.startTime.getTime()) / 1000);
    const hasActivity = session.writeCallMade || session.toolCalls.length > 2;

    if (hasActivity && store.exists()) {
      try {
        const date = new Date().toISOString().split("T")[0];
        const summary = buildSessionSummary(session, duration);
        store.appendEntry("sessions", `auto-${date}`, summary);
      } catch {
        // Best-effort, don't fail shutdown
      }
    }

    if (searchIndex) {
      searchIndex.close();
      searchIndex = null;
    }
    if (globalSearchIndex) {
      globalSearchIndex.close();
      globalSearchIndex = null;
    }
    process.exit(0);
  };

  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);
  process.stdin.on("end", cleanup);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export function getRelativeTime(date: Date): string {
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 2592000) return `${Math.floor(seconds / 86400)}d ago`;
  return `${Math.floor(seconds / 2592000)}mo ago`;
}
