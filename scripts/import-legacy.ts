#!/usr/bin/env npx tsx
/**
 * Import existing PAI memory files into PAI Memory MCP (Convex).
 *
 * Usage:
 *   npx tsx scripts/import-legacy.ts --all             # All project memory dirs + ~/.claude/MEMORY/
 *   npx tsx scripts/import-legacy.ts ~/.claude/MEMORY/  # Specific directory
 *   npx tsx scripts/import-legacy.ts ~/path/to/memory/dir
 */

import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { embed } from "../src/embed";
import { loadConfig, isProjectExcluded, redactContent, extractProjectName, type PaiMemoryConfig } from "../src/config";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

function getConvexClient(): ConvexHttpClient {
  const url = process.env.CONVEX_URL;
  if (!url) {
    console.error("Error: CONVEX_URL environment variable not set");
    process.exit(1);
  }
  return new ConvexHttpClient(url);
}

interface MemoryFile {
  filepath: string;
  name: string;
  description: string;
  type: string;
  content: string;
}

function parseMemoryFile(filepath: string): MemoryFile | null {
  const raw = fs.readFileSync(filepath, "utf-8");

  // Parse YAML frontmatter
  const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!frontmatterMatch) {
    // No frontmatter — treat entire file as content
    const basename = path.basename(filepath, path.extname(filepath));
    return {
      filepath,
      name: basename,
      description: `Imported from ${basename}`,
      type: inferTypeFromPath(filepath),
      content: raw.trim(),
    };
  }

  const [, frontmatter, body] = frontmatterMatch;
  const meta: Record<string, string> = {};

  for (const line of frontmatter.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    meta[key] = value;
  }

  return {
    filepath,
    name: meta.name || path.basename(filepath, path.extname(filepath)),
    description: meta.description || "",
    type: meta.type || inferTypeFromPath(filepath),
    content: body.trim(),
  };
}

function inferTypeFromPath(filepath: string): string {
  const lower = filepath.toLowerCase();
  if (lower.includes("user")) return "user";
  if (lower.includes("feedback")) return "feedback";
  if (lower.includes("project")) return "project";
  if (lower.includes("reference")) return "reference";
  if (lower.includes("learning")) return "learning";
  return "reference"; // default
}

function findMemoryFiles(dir: string): string[] {
  const files: string[] = [];

  function walk(d: string) {
    for (const entry of fs.readdirSync(d)) {
      const full = path.join(d, entry);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        // Skip WORK and STATE directories
        if (entry === "WORK" || entry === "STATE") continue;
        walk(full);
      } else if (entry.endsWith(".md") && entry !== "MEMORY.md") {
        files.push(full);
      }
    }
  }

  walk(dir);
  return files;
}

function findAllMemoryDirs(): string[] {
  const claudeDir = path.join(os.homedir(), ".claude");
  const dirs: string[] = [];

  // Global MEMORY directory
  const globalMemory = path.join(claudeDir, "MEMORY");
  if (fs.existsSync(globalMemory)) dirs.push(globalMemory);

  // Per-project memory directories
  const projectsDir = path.join(claudeDir, "projects");
  if (fs.existsSync(projectsDir)) {
    for (const projectDir of fs.readdirSync(projectsDir)) {
      const memDir = path.join(projectsDir, projectDir, "memory");
      if (fs.existsSync(memDir) && fs.statSync(memDir).isDirectory()) {
        dirs.push(memDir);
      }
    }
  }

  return dirs;
}

function extractProjectFromDir(dir: string, config: PaiMemoryConfig): string | undefined {
  const match = dir.match(/projects\/([^/]+)\/memory/);
  if (!match) return undefined;
  return extractProjectName(match[1], config);
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.log("Usage:");
    console.log("  npx tsx scripts/import-legacy.ts --all              # All memory directories");
    console.log("  npx tsx scripts/import-legacy.ts ~/.claude/MEMORY/  # Specific directory");
    process.exit(0);
  }

  const client = getConvexClient();
  const config = loadConfig();

  if (config.excludeProjects.length > 0) {
    console.log(`Excluding projects: ${config.excludeProjects.join(", ")}`);
  }

  let allFiles: Array<{ filepath: string; project?: string }> = [];

  if (arg === "--all") {
    const dirs = findAllMemoryDirs();
    console.log(`Found ${dirs.length} memory directories:`);
    for (const dir of dirs) {
      const project = extractProjectFromDir(dir, config);
      const files = findMemoryFiles(dir);
      console.log(`  ${dir} (${files.length} files${project ? `, project: ${project}` : ""})`);
      allFiles.push(...files.map((f) => ({ filepath: f, project })));
    }
  } else {
    const resolvedDir = path.resolve(arg);
    if (!fs.existsSync(resolvedDir)) {
      console.error(`Directory not found: ${resolvedDir}`);
      process.exit(1);
    }
    const files = findMemoryFiles(resolvedDir);
    const project = extractProjectFromDir(resolvedDir, config);
    allFiles = files.map((f) => ({ filepath: f, project }));
  }

  console.log(`\n${allFiles.length} total memory files to import.`);

  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (const { filepath, project } of allFiles) {
    const relPath = path.relative(os.homedir(), filepath);
    process.stdout.write(`  ${relPath}... `);

    try {
      if (isProjectExcluded(project, config)) {
        console.log("skipped (excluded project)");
        skipped++;
        continue;
      }

      const memory = parseMemoryFile(filepath);
      if (!memory || !memory.content) {
        console.log("skipped (empty)");
        skipped++;
        continue;
      }

      // Redact secrets before embedding or storing
      const { content: safeContent } = redactContent(memory.content, config);

      const embedding = await embed(safeContent);

      await client.mutation(anyApi.memories.insert, {
        type: memory.type,
        title: memory.name,
        content: safeContent,
        embedding,
        project,
        tags: ["legacy-import"],
      });

      console.log(`imported (${memory.type}${project ? `, ${project}` : ""})`);
      imported++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.log(`ERROR: ${msg}`);
      failed++;
    }
  }

  console.log(`\nDone: ${imported} imported, ${skipped} skipped, ${failed} failed`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
