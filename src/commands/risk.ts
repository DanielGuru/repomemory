import chalk from "chalk";
import { analyzeGitIntelligence, assessFileRisk } from "../lib/git-intelligence.js";

export async function riskCommand(options: {
  dir?: string;
  files?: string;
  limit?: string;
  maxCommits?: string;
  json?: boolean;
}) {
  const repoRoot = options.dir || process.cwd();
  const topN = parseInt(options.limit || "15");
  const maxCommits = parseInt(options.maxCommits || "500");

  if (options.files) {
    // Targeted assessment
    const targets = options.files.split(",").map((f) => f.trim());
    console.log(chalk.bold(`\n🔍 Assessing risk for ${targets.length} file${targets.length === 1 ? "" : "s"}...\n`));

    const result = assessFileRisk(repoRoot, targets, { maxCommits });

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    for (const a of result.assessments) {
      const color = a.riskLevel === "high" ? chalk.red : a.riskLevel === "medium" ? chalk.yellow : chalk.green;
      const icon = a.riskLevel === "high" ? "⚠️" : a.riskLevel === "medium" ? "⚡" : "✅";
      console.log(`${icon} ${chalk.bold(a.file)} — ${color(a.riskLevel + " risk")}`);

      if (a.riskFactors.length > 0) {
        for (const f of a.riskFactors) {
          console.log(chalk.dim(`   ${f}`));
        }
      } else {
        console.log(chalk.dim("   No significant risk factors detected"));
      }

      if (a.ownership) {
        console.log(
          chalk.dim(`   Owner: ${a.ownership.primaryOwner} (${a.ownership.ownershipPct}%), bus factor: ${a.ownership.busFactor}`)
        );
      }

      if (a.coChangePartners.length > 0) {
        console.log(chalk.dim("   Often changes with:"));
        for (const c of a.coChangePartners) {
          const partner = c.fileA === a.file ? c.fileB : c.fileA;
          console.log(chalk.dim(`     - ${partner} (${c.coChangeCount} co-changes)`));
        }
      }
      console.log();
    }
    return;
  }

  // Global overview
  console.log(chalk.bold(`\n🔍 Analyzing git intelligence (up to ${maxCommits} commits)...\n`));

  const intel = analyzeGitIntelligence(repoRoot, { maxCommits, topN });

  if (intel.analyzedCommits === 0) {
    throw new Error("No git history found. Is this a git repository?");
  }

  if (options.json) {
    console.log(JSON.stringify(intel, null, 2));
    return;
  }

  console.log(chalk.dim(`  Analyzed ${intel.analyzedCommits} commits over ${intel.timespan}\n`));

  // Hotspots
  if (intel.hotspots.length > 0) {
    console.log(chalk.bold.red("  🔥 Hotspot Files (high churn — modify with care)\n"));
    for (const h of intel.hotspots) {
      const bar = renderBar(h.score);
      console.log(`  ${bar} ${chalk.bold(h.file)}`);
      console.log(chalk.dim(`       ${h.commits} commits, ${h.churn} lines churned, ${h.authors} authors\n`));
    }
  }

  // Co-change pairs
  if (intel.coChangePairs.length > 0) {
    console.log(chalk.bold.yellow("  🔗 Hidden Coupling (files that change together)\n"));
    for (const c of intel.coChangePairs.slice(0, 10)) {
      console.log(`  ${chalk.cyan(c.fileA)} ↔ ${chalk.cyan(c.fileB)}`);
      console.log(chalk.dim(`       ${c.coChangeCount} co-changes, confidence: ${c.confidence}\n`));
    }
  }

  // Ownership
  if (intel.ownership.length > 0) {
    console.log(chalk.bold.blue("  👤 Ownership Concentration\n"));
    for (const o of intel.ownership) {
      const risk = o.busFactor === 1 ? chalk.red(" ⚠️ bus-factor risk") : "";
      console.log(`  ${chalk.bold(o.file)} — ${o.primaryOwner} (${o.ownershipPct}%), bus factor: ${o.busFactor}${risk}`);
    }
    console.log();
  }
}

function renderBar(score: number): string {
  const width = 15;
  const filled = Math.round(score * width);
  const empty = width - filled;
  const color = score >= 0.7 ? chalk.red : score >= 0.4 ? chalk.yellow : chalk.green;
  return color("█".repeat(filled) + "░".repeat(empty)) + chalk.dim(` ${(score * 100).toFixed(0)}%`);
}
