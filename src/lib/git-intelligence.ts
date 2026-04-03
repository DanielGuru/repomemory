import { execFileSync } from "child_process";

// --- Types ---

export interface FileHotspot {
  file: string;
  commits: number;
  authors: number;
  insertions: number;
  deletions: number;
  churn: number; // insertions + deletions
  score: number; // normalized 0-1 hotspot score
}

export interface CoChangePair {
  fileA: string;
  fileB: string;
  coChangeCount: number;
  confidence: number; // 0-1, based on how often they co-change vs individual changes
}

export interface FileOwnership {
  file: string;
  primaryOwner: string;
  ownershipPct: number;
  contributors: { name: string; commits: number; pct: number }[];
  busFactor: number; // how many people needed to cover 80% of commits
}

export interface GitIntelligence {
  hotspots: FileHotspot[];
  coChangePairs: CoChangePair[];
  ownership: FileOwnership[];
  analyzedCommits: number;
  timespan: string; // e.g. "6 months"
}

// --- Helpers ---

function git(args: string[], cwd: string, timeout = 30_000): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf-8",
      timeout,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

// --- Analysis Functions ---

/**
 * Analyze git history to find hotspot files (high churn).
 * Uses `git log --numstat` to count per-file changes.
 */
function analyzeHotspots(repoRoot: string, maxCommits: number): FileHotspot[] {
  // Get per-file change stats from git log
  const log = git(["log", `--max-count=${maxCommits}`, "--no-merges", "--format=%H", "--numstat"], repoRoot, 60_000);

  if (!log) return [];

  const fileStats = new Map<
    string,
    { commits: Set<string>; authors: Set<string>; insertions: number; deletions: number }
  >();

  // Also get per-commit authors
  const commitAuthors = new Map<string, string>();
  const authorLog = git(["log", `--max-count=${maxCommits}`, "--no-merges", "--format=%H%x00%an"], repoRoot, 30_000);
  for (const line of authorLog.split("\n")) {
    const [hash, author] = line.split("\0");
    if (hash && author) commitAuthors.set(hash, author);
  }

  let currentCommit = "";
  for (const line of log.split("\n")) {
    if (!line) continue;

    // Lines with only a hash (40 hex chars)
    if (/^[0-9a-f]{40}$/.test(line)) {
      currentCommit = line;
      continue;
    }

    // numstat lines: insertions \t deletions \t file
    const match = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (!match || !currentCommit) continue;

    const insertions = match[1] === "-" ? 0 : parseInt(match[1]);
    const deletions = match[2] === "-" ? 0 : parseInt(match[2]);
    const file = match[3];

    // Skip binary files and deleted files
    if (file.includes(" => ")) continue; // renamed files in diff format

    let stats = fileStats.get(file);
    if (!stats) {
      stats = { commits: new Set(), authors: new Set(), insertions: 0, deletions: 0 };
      fileStats.set(file, stats);
    }

    stats.commits.add(currentCommit);
    const author = commitAuthors.get(currentCommit);
    if (author) stats.authors.add(author);
    stats.insertions += insertions;
    stats.deletions += deletions;
  }

  // Convert to hotspot entries and compute scores
  const hotspots: FileHotspot[] = [];
  for (const [file, stats] of fileStats) {
    const churn = stats.insertions + stats.deletions;
    hotspots.push({
      file,
      commits: stats.commits.size,
      authors: stats.authors.size,
      insertions: stats.insertions,
      deletions: stats.deletions,
      churn,
      score: 0, // computed after normalization
    });
  }

  if (hotspots.length === 0) return [];

  // Normalize scores: churn × commit_count (files that change often AND change a lot)
  const maxChurn = Math.max(...hotspots.map((h) => h.churn));
  const maxCommitCount = Math.max(...hotspots.map((h) => h.commits));

  for (const h of hotspots) {
    const churnNorm = maxChurn > 0 ? h.churn / maxChurn : 0;
    const commitNorm = maxCommitCount > 0 ? h.commits / maxCommitCount : 0;
    h.score = Math.round((churnNorm * 0.6 + commitNorm * 0.4) * 100) / 100;
  }

  // Sort by score descending and return top entries
  hotspots.sort((a, b) => b.score - a.score);
  return hotspots;
}

/**
 * Find files that frequently change together (co-change detection).
 * Uses commit history to find file pairs that appear in the same commits.
 */
function analyzeCoChanges(repoRoot: string, maxCommits: number, minCoChanges = 3): CoChangePair[] {
  // Get files per commit
  const log = git(["log", `--max-count=${maxCommits}`, "--no-merges", "--format=%H", "--name-only"], repoRoot, 60_000);

  if (!log) return [];

  const commitFiles = new Map<string, string[]>();
  const fileCommitCounts = new Map<string, number>();
  let currentCommit = "";

  for (const line of log.split("\n")) {
    if (!line) continue;

    if (/^[0-9a-f]{40}$/.test(line)) {
      currentCommit = line;
      if (!commitFiles.has(currentCommit)) commitFiles.set(currentCommit, []);
      continue;
    }

    if (currentCommit) {
      commitFiles.get(currentCommit)!.push(line);
      fileCommitCounts.set(line, (fileCommitCounts.get(line) || 0) + 1);
    }
  }

  // Count co-change pairs (only for commits with 2-15 files to avoid noise from large commits)
  const pairCounts = new Map<string, number>();

  for (const [, files] of commitFiles) {
    if (files.length < 2 || files.length > 15) continue;

    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const key = files[i] < files[j] ? `${files[i]}\0${files[j]}` : `${files[j]}\0${files[i]}`;
        pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
      }
    }
  }

  // Build results with confidence scores
  const pairs: CoChangePair[] = [];
  for (const [key, count] of pairCounts) {
    if (count < minCoChanges) continue;

    const [fileA, fileB] = key.split("\0");
    const countA = fileCommitCounts.get(fileA) || 1;
    const countB = fileCommitCounts.get(fileB) || 1;

    // Confidence: how often they co-change relative to each file's individual change frequency
    // Jaccard-like: co-changes / (changes_A + changes_B - co-changes)
    const confidence = Math.round((count / (countA + countB - count)) * 100) / 100;

    pairs.push({ fileA, fileB, coChangeCount: count, confidence });
  }

  pairs.sort((a, b) => b.coChangeCount - a.coChangeCount);
  return pairs;
}

/**
 * Analyze file ownership from git blame/shortlog.
 * Uses `git shortlog` per-file for efficiency.
 */
function analyzeOwnership(repoRoot: string, files: string[]): FileOwnership[] {
  const ownership: FileOwnership[] = [];

  for (const file of files) {
    // Use shortlog for the specific file
    const shortlog = git(["shortlog", "-sn", "--no-merges", "HEAD", "--", file], repoRoot);
    if (!shortlog) continue;

    const contributors: { name: string; commits: number; pct: number }[] = [];
    let totalCommits = 0;

    for (const line of shortlog.split("\n")) {
      const match = line.trim().match(/^(\d+)\s+(.+)$/);
      if (!match) continue;
      const commits = parseInt(match[1]);
      totalCommits += commits;
      contributors.push({ name: match[2], commits, pct: 0 });
    }

    if (contributors.length === 0) continue;

    // Calculate percentages
    for (const c of contributors) {
      c.pct = Math.round((c.commits / totalCommits) * 100);
    }

    // Bus factor: minimum contributors to cover 80% of commits
    let cumulative = 0;
    let busFactor = 0;
    for (const c of contributors) {
      cumulative += c.pct;
      busFactor++;
      if (cumulative >= 80) break;
    }

    ownership.push({
      file,
      primaryOwner: contributors[0].name,
      ownershipPct: contributors[0].pct,
      contributors: contributors.slice(0, 5), // top 5
      busFactor,
    });
  }

  return ownership;
}

// --- Main Entry Point ---

/**
 * Run full git intelligence analysis on a repository.
 * Analyzes up to `maxCommits` of history (default 500).
 */
export function analyzeGitIntelligence(
  repoRoot: string,
  options: { maxCommits?: number; topN?: number } = {}
): GitIntelligence {
  const maxCommits = options.maxCommits ?? 500;
  const topN = options.topN ?? 20;

  // Check if it's a git repo
  const isGit = git(["rev-parse", "--is-inside-work-tree"], repoRoot);
  if (isGit !== "true") {
    return { hotspots: [], coChangePairs: [], ownership: [], analyzedCommits: 0, timespan: "N/A" };
  }

  // Get timespan info
  const totalCommitsStr = git(["rev-list", "--count", `--max-count=${maxCommits}`, "HEAD"], repoRoot);
  const analyzedCommits = parseInt(totalCommitsStr) || 0;

  let timespan = "N/A";
  if (analyzedCommits > 0) {
    const oldestDate = git(["log", `--max-count=${maxCommits}`, "--reverse", "--format=%ai", "HEAD"], repoRoot, 30_000)
      .split("\n")
      .filter(Boolean)[0];

    if (oldestDate) {
      const days = Math.round((Date.now() - new Date(oldestDate).getTime()) / (1000 * 60 * 60 * 24));
      if (days > 365) timespan = `${Math.round(days / 365)} year${days > 730 ? "s" : ""}`;
      else if (days > 30) timespan = `${Math.round(days / 30)} month${days > 60 ? "s" : ""}`;
      else timespan = `${days} day${days !== 1 ? "s" : ""}`;
    }
  }

  // Run analyses
  const allHotspots = analyzeHotspots(repoRoot, maxCommits);
  const hotspots = allHotspots.slice(0, topN);

  const coChangePairs = analyzeCoChanges(repoRoot, maxCommits).slice(0, topN);

  // Ownership only for hotspot files (expensive per-file)
  const hotspotFiles = hotspots.slice(0, 10).map((h) => h.file);
  const ownership = analyzeOwnership(repoRoot, hotspotFiles);

  return { hotspots, coChangePairs, ownership, analyzedCommits, timespan };
}

/**
 * Get risk assessment for specific files.
 * Returns hotspot score, co-change partners, and ownership info.
 */
export function assessFileRisk(
  repoRoot: string,
  targets: string[],
  options: { maxCommits?: number } = {}
): {
  assessments: Array<{
    file: string;
    hotspot: FileHotspot | null;
    coChangePartners: CoChangePair[];
    ownership: FileOwnership | null;
    riskLevel: "low" | "medium" | "high";
    riskFactors: string[];
  }>;
  globalHotspots: FileHotspot[];
} {
  const maxCommits = options.maxCommits ?? 500;

  const allHotspots = analyzeHotspots(repoRoot, maxCommits);
  const allCoChanges = analyzeCoChanges(repoRoot, maxCommits);
  const ownershipData = analyzeOwnership(repoRoot, targets);

  const assessments = targets.map((file) => {
    const hotspot = allHotspots.find((h) => h.file === file) || null;
    const coChangePartners = allCoChanges.filter((c) => c.fileA === file || c.fileB === file).slice(0, 5);
    const ownership = ownershipData.find((o) => o.file === file) || null;

    // Determine risk level
    const riskFactors: string[] = [];

    if (hotspot && hotspot.score >= 0.7) {
      riskFactors.push(
        `High churn hotspot (score: ${hotspot.score}, ${hotspot.commits} commits, ${hotspot.churn} lines changed)`
      );
    } else if (hotspot && hotspot.score >= 0.4) {
      riskFactors.push(`Moderate churn (score: ${hotspot.score}, ${hotspot.commits} commits)`);
    }

    if (ownership && ownership.busFactor === 1) {
      riskFactors.push(`Bus factor risk: only ${ownership.primaryOwner} (${ownership.ownershipPct}% of commits)`);
    }

    if (coChangePartners.length > 0) {
      const partners = coChangePartners.map((c) => (c.fileA === file ? c.fileB : c.fileA));
      riskFactors.push(`Hidden coupling: often changes with ${partners.slice(0, 3).join(", ")}`);
    }

    let riskLevel: "low" | "medium" | "high" = "low";
    if (hotspot && hotspot.score >= 0.7) riskLevel = "high";
    else if (riskFactors.length >= 2 || (hotspot && hotspot.score >= 0.4)) riskLevel = "medium";

    return { file, hotspot, coChangePartners, ownership, riskLevel, riskFactors };
  });

  return {
    assessments,
    globalHotspots: allHotspots.slice(0, 5),
  };
}
