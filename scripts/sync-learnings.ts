#!/usr/bin/env npx tsx
/**
 * Sync PAI LEARNING and WORK data to PAI Memory MCP (Convex).
 *
 * Reads algorithm reflections from LEARNING/REFLECTIONS/algorithm-reflections.jsonl
 * and completed PRDs from WORK/ directories, then pushes them as curated memories.
 *
 * Usage:
 *   npx tsx scripts/sync-learnings.ts              # Sync new items since last run
 *   npx tsx scripts/sync-learnings.ts --all         # Sync everything (backfill)
 *   npx tsx scripts/sync-learnings.ts --dry-run     # Show what would be synced
 *
 * Can also be called as a SessionEnd hook (exits 0 on any failure).
 */

import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { embed, embedBatch } from "../src/embed";
import { loadConfig, redactContent, type PaiMemoryConfig } from "../src/config";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const CLAUDE_DIR = path.join(os.homedir(), ".claude");
const MEMORY_DIR = path.join(CLAUDE_DIR, "MEMORY");
const REFLECTIONS_FILE = path.join(MEMORY_DIR, "LEARNING", "REFLECTIONS", "algorithm-reflections.jsonl");
const WORK_DIR = path.join(MEMORY_DIR, "WORK");
const STATE_FILE = path.join(os.homedir(), ".pai-memory-sync-learnings.json");
const COMPLETED_PHASES = ["complete", "learn"] as const;
const MAX_PRD_CONTENT_LENGTH = 2000;

interface SyncState {
  lastReflectionTimestamp: string | null;
  syncedPrdSlugs: string[];
}

interface Reflection {
  timestamp: string;
  effort_level: string;
  task_description: string;
  criteria_count: number;
  criteria_passed: number;
  criteria_failed: number;
  prd_id: string;
  implied_sentiment: number;
  reflection_q1: string;
  reflection_q2: string;
  reflection_q3: string;
  within_budget: boolean;
}

interface PrdFrontmatter {
  task?: string;
  slug?: string;
  effort?: string;
  phase?: string;
  progress?: string;
  mode?: string;
  started?: string;
  updated?: string;
}

function getConvexClient(): ConvexHttpClient {
  // Try .env.local in repo first
  const scriptDir = path.dirname(new URL(import.meta.url).pathname);
  const envLocalPath = path.join(path.dirname(scriptDir), ".env.local");
  if (fs.existsSync(envLocalPath)) {
    const envContent = fs.readFileSync(envLocalPath, "utf-8");
    const urlMatch = envContent.match(/^CONVEX_URL=(.+)$/m);
    if (urlMatch) {
      return new ConvexHttpClient(urlMatch[1].trim());
    }
  }

  // Fall back to env var
  const url = process.env.CONVEX_URL;
  if (!url) {
    throw new Error("No CONVEX_URL found in .env.local or environment");
  }
  return new ConvexHttpClient(url);
}

function loadSyncState(): SyncState {
  if (fs.existsSync(STATE_FILE)) {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  }
  return { lastReflectionTimestamp: null, syncedPrdSlugs: [] };
}

function saveSyncState(state: SyncState): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function parsePrdFrontmatter(content: string): { frontmatter: PrdFrontmatter; body: string } | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return null;

  const fm: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, "");
    fm[key] = value;
  }

  return { frontmatter: fm as unknown as PrdFrontmatter, body: match[2].trim() };
}

function readReflections(sinceTimestamp: string | null): Reflection[] {
  if (!fs.existsSync(REFLECTIONS_FILE)) return [];

  const lines = fs.readFileSync(REFLECTIONS_FILE, "utf-8").trim().split("\n");
  const reflections: Reflection[] = [];

  const sinceMs = sinceTimestamp ? new Date(sinceTimestamp).getTime() : 0;

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as Reflection;
      const rMs = new Date(r.timestamp).getTime();
      if (!sinceTimestamp || rMs > sinceMs) {
        reflections.push(r);
      }
    } catch {
      // Skip malformed lines
    }
  }

  return reflections;
}

function readPrds(syncedSlugs: string[], syncAll: boolean): Array<{ slug: string; content: string; frontmatter: PrdFrontmatter; body: string }> {
  if (!fs.existsSync(WORK_DIR)) return [];

  const prds: Array<{ slug: string; content: string; frontmatter: PrdFrontmatter; body: string }> = [];

  for (const dir of fs.readdirSync(WORK_DIR)) {
    if (!syncAll && syncedSlugs.includes(dir)) continue;

    const prdPath = path.join(WORK_DIR, dir, "PRD.md");
    if (!fs.existsSync(prdPath)) continue;

    const content = fs.readFileSync(prdPath, "utf-8");
    const parsed = parsePrdFrontmatter(content);
    if (!parsed) continue;

    // Only sync completed PRDs (or all if --all)
    if (!syncAll && !COMPLETED_PHASES.includes(parsed.frontmatter.phase as any)) continue;

    prds.push({ slug: dir, content, frontmatter: parsed.frontmatter, body: parsed.body });
  }

  return prds;
}

function reflectionToContent(r: Reflection): string {
  const lines = [
    `**Task:** ${r.task_description}`,
    `**Effort:** ${r.effort_level} | **Criteria:** ${r.criteria_passed}/${r.criteria_count} passed | **Sentiment:** ${r.implied_sentiment}/10 | **Budget:** ${r.within_budget ? "within" : "over"}`,
    "",
    `**What should I have done differently?** ${r.reflection_q1}`,
    "",
    `**What would a smarter algorithm have done?** ${r.reflection_q2}`,
    "",
    `**What capabilities should I have used?** ${r.reflection_q3}`,
  ];
  return lines.join("\n");
}

function prdToContent(frontmatter: PrdFrontmatter, body: string): string {
  // Include the task name and key sections, truncated for memory storage
  const lines = [`**Task:** ${frontmatter.task || "Unknown"}`];
  if (frontmatter.effort) lines.push(`**Effort:** ${frontmatter.effort}`);
  if (frontmatter.progress) lines.push(`**Progress:** ${frontmatter.progress}`);
  lines.push("");

  const truncated = body.length > MAX_PRD_CONTENT_LENGTH
    ? body.slice(0, MAX_PRD_CONTENT_LENGTH) + "\n\n[truncated]"
    : body;
  lines.push(truncated);

  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const syncAll = args.includes("--all");
  const dryRun = args.includes("--dry-run");
  const isHook = args.includes("--hook");

  const config = loadConfig();
  const state = syncAll ? { lastReflectionTimestamp: null, syncedPrdSlugs: [] } : loadSyncState();

  // Gather items to sync
  const reflections = readReflections(syncAll ? null : state.lastReflectionTimestamp);
  const prds = readPrds(syncAll ? [] : state.syncedPrdSlugs, syncAll);

  if (reflections.length === 0 && prds.length === 0) {
    if (!isHook) console.log("Nothing new to sync.");
    return;
  }

  if (!isHook) {
    console.log(`Found ${reflections.length} reflection(s) and ${prds.length} PRD(s) to sync.`);
  }

  if (dryRun) {
    for (const r of reflections) {
      console.log(`  [reflection] ${r.timestamp} — ${r.task_description}`);
    }
    for (const p of prds) {
      console.log(`  [prd] ${p.slug} — ${p.frontmatter.task}`);
    }
    return;
  }

  const client = getConvexClient();
  let synced = 0;
  let failed = 0;

  // Prepare all items for batch embedding
  interface SyncItem {
    type: "learning" | "work";
    subtype: string;
    title: string;
    content: string;
    tags: string[];
    // For state tracking after insert
    reflectionTimestamp?: string;
    prdSlug?: string;
  }

  const items: SyncItem[] = [];

  for (const r of reflections) {
    const raw = reflectionToContent(r);
    const { content } = redactContent(raw, config);
    items.push({
      type: "learning",
      subtype: "reflection",
      title: `Algorithm reflection: ${r.task_description}`,
      content,
      tags: ["sync-learning", `prd:${r.prd_id}`],
      reflectionTimestamp: r.timestamp,
    });
  }

  for (const p of prds) {
    const raw = prdToContent(p.frontmatter, p.body);
    const { content } = redactContent(raw, config);
    items.push({
      type: "work",
      subtype: "prd",
      title: `PRD: ${p.frontmatter.task || p.slug}`,
      content,
      tags: ["sync-work", `slug:${p.slug}`],
      prdSlug: p.slug,
    });
  }

  // Batch embed all items at once
  const embeddings = await embedBatch(items.map((i) => i.content));

  // Insert sequentially (Convex mutations are fast, embedding was the bottleneck)
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    try {
      await client.mutation(anyApi.memories.insert, {
        type: item.type,
        subtype: item.subtype,
        title: item.title,
        content: item.content,
        embedding: embeddings[i],
        tags: item.tags,
      });

      if (item.reflectionTimestamp) {
        state.lastReflectionTimestamp = item.reflectionTimestamp;
      }
      if (item.prdSlug) {
        state.syncedPrdSlugs.push(item.prdSlug);
      }
      synced++;
      if (!isHook) process.stdout.write(".");
    } catch (err) {
      failed++;
      if (!isHook) {
        const msg = err instanceof Error ? err.message : "Unknown";
        console.error(`\n  [${item.type}] ${item.title} FAILED: ${msg}`);
      }
    }
  }

  saveSyncState(state);

  if (!isHook) {
    console.log(`\nDone: ${synced} synced, ${failed} failed.`);
  }
}

main().catch((err) => {
  // In hook mode, exit cleanly on any error
  if (process.argv.includes("--hook")) {
    process.exit(0);
  }
  console.error("Fatal error:", err);
  process.exit(1);
});
