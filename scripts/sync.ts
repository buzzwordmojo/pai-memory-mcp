#!/usr/bin/env npx tsx
/**
 * Sync session transcripts to PAI Memory MCP (Convex).
 *
 * Usage:
 *   npx tsx scripts/sync.ts --all           # Backfill all sessions
 *   npx tsx scripts/sync.ts --since 7d      # Last 7 days
 *   npx tsx scripts/sync.ts --session <uuid> # Specific session
 */

import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { embed, embedBatch } from "../src/embed";
import { chunkSession, RawMessage } from "../src/chunker";
import { loadConfig, isProjectExcluded, redactContent, extractProjectName, type PaiMemoryConfig } from "../src/config";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const CLAUDE_DIR = path.join(os.homedir(), ".claude");
const PROJECTS_DIR = path.join(CLAUDE_DIR, "projects");

function getConvexClient(): ConvexHttpClient {
  const url = process.env.CONVEX_URL;
  if (!url) {
    console.error("Error: CONVEX_URL environment variable not set");
    console.error("Set it to your Convex deployment URL (e.g., https://your-project.convex.cloud)");
    process.exit(1);
  }
  return new ConvexHttpClient(url);
}

function getAuthToken(): string {
  const token = process.env.MEMORY_AUTH_TOKEN;
  if (!token) {
    console.error("Error: MEMORY_AUTH_TOKEN environment variable not set");
    process.exit(1);
  }
  return token;
}

interface SessionInfo {
  id: string;
  projectPath: string;
  timestamp: number;
  jsonlPath: string;
}

function findSessions(since?: number): SessionInfo[] {
  const sessions: SessionInfo[] = [];

  if (!fs.existsSync(PROJECTS_DIR)) {
    console.error(`No projects directory found at ${PROJECTS_DIR}`);
    return sessions;
  }

  // Walk project directories
  for (const projectDir of fs.readdirSync(PROJECTS_DIR)) {
    const projectPath = path.join(PROJECTS_DIR, projectDir);
    if (!fs.statSync(projectPath).isDirectory()) continue;

    for (const entry of fs.readdirSync(projectPath)) {
      const entryPath = path.join(projectPath, entry);

      // Pattern 1: <uuid>.jsonl directly in project dir
      if (entry.endsWith(".jsonl") && /^[0-9a-f-]{36}\.jsonl$/.test(entry)) {
        const sessionId = entry.replace(".jsonl", "");
        const stat = fs.statSync(entryPath);
        if (since && stat.mtimeMs < since) continue;

        sessions.push({
          id: sessionId,
          projectPath: projectDir,
          timestamp: stat.mtimeMs,
          jsonlPath: entryPath,
        });
        continue;
      }

      // Pattern 2: <uuid>/ directory containing JSONL files
      if (fs.statSync(entryPath).isDirectory() && /^[0-9a-f-]{36}$/.test(entry)) {
        const jsonlFiles = fs.readdirSync(entryPath).filter((f) => f.endsWith(".jsonl"));
        if (jsonlFiles.length === 0) continue;

        const jsonlPath = path.join(entryPath, jsonlFiles[0]);
        const stat = fs.statSync(jsonlPath);
        if (since && stat.mtimeMs < since) continue;

        sessions.push({
          id: entry,
          projectPath: projectDir,
          timestamp: stat.mtimeMs,
          jsonlPath,
        });
      }
    }
  }

  return sessions.sort((a, b) => a.timestamp - b.timestamp);
}

// Non-message JSONL types to skip entirely
const SKIP_TYPES = new Set([
  "queue-operation",
  "file-history-snapshot",
  "progress",
  "last-prompt",
]);

function parseJsonl(filepath: string): RawMessage[] {
  const raw = fs.readFileSync(filepath, "utf-8");
  const messages: RawMessage[] = [];

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: any;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }

    // Skip non-message types
    if (SKIP_TYPES.has(entry.type)) continue;
    if (entry.isMeta) continue;

    // Extract content — may be at entry.message.content or entry.content
    let content: string | undefined;
    if (entry.message?.content) {
      const mc = entry.message.content;
      if (typeof mc === "string") {
        content = mc;
      } else if (Array.isArray(mc)) {
        // Array of content blocks — extract text parts
        content = mc
          .filter((b: any) => b.type === "text" && b.text)
          .map((b: any) => b.text)
          .join("\n\n");
      }
    } else if (typeof entry.content === "string") {
      content = entry.content;
    }

    if (!content?.trim()) continue;

    // Normalize type names to what the chunker expects
    let type = entry.type;
    if (type === "user") type = "human";
    // "assistant" stays as-is
    // "system" stays as-is
    // "tool_use" / "tool_result" stay as-is

    messages.push({
      type,
      content,
      tool_name: entry.message?.tool_name ?? entry.tool_name,
      is_error: entry.is_error,
    });
  }

  return messages;
}


async function syncSession(
  client: ConvexHttpClient,
  session: SessionInfo,
  config: PaiMemoryConfig
): Promise<{ chunksIngested: number; skipped: boolean; reason?: string }> {
  const project = extractProjectName(session.projectPath, config);

  // Check project exclusion
  if (isProjectExcluded(project, config)) {
    return { chunksIngested: 0, skipped: true, reason: "excluded project" };
  }

  // Check if already ingested
  const exists = await client.query(anyApi.chunks.sessionExists, {
    sessionId: session.id,
  });
  if (exists) {
    return { chunksIngested: 0, skipped: true };
  }

  // Parse and chunk
  const messages = parseJsonl(session.jsonlPath);
  if (messages.length === 0) {
    return { chunksIngested: 0, skipped: true };
  }

  const rawChunks = chunkSession(messages, session.timestamp);
  if (rawChunks.length === 0) {
    return { chunksIngested: 0, skipped: true };
  }

  // Redact sensitive content
  const chunks = rawChunks.map((chunk) => {
    const { content, redacted } = redactContent(chunk.content, config);
    return redacted ? { ...chunk, content } : chunk;
  });

  // Generate embeddings for signal chunks
  const signalChunks = chunks.filter((c) => c.isSignal);
  const signalTexts = signalChunks.map((c) => c.content);

  let embeddings: number[][] = [];
  if (signalTexts.length > 0) {
    // Batch embed in groups of 32
    const EMBED_BATCH = 32;
    for (let i = 0; i < signalTexts.length; i += EMBED_BATCH) {
      const batch = signalTexts.slice(i, i + EMBED_BATCH);
      const batchEmbeddings = await embedBatch(batch);
      embeddings.push(...batchEmbeddings);
    }
  }

  // Attach embeddings to signal chunks
  let embIdx = 0;
  const chunksWithEmbeddings = chunks.map((chunk) => {
    if (chunk.isSignal && embIdx < embeddings.length) {
      return { ...chunk, embedding: embeddings[embIdx++] };
    }
    return chunk;
  });

  const BATCH_SIZE = 50;

  for (let i = 0; i < chunksWithEmbeddings.length; i += BATCH_SIZE) {
    const batch = chunksWithEmbeddings.slice(i, i + BATCH_SIZE).map((c) => ({
      sessionId: session.id,
      project,
      sequence: c.sequence,
      role: c.role,
      content: c.content,
      chunkType: c.chunkType,
      isSignal: c.isSignal,
      tokensApprox: c.tokensApprox,
      embedding: c.isSignal ? c.embedding : undefined,
      metadata: c.metadata,
      createdAt: c.createdAt,
    }));

    await client.mutation(anyApi.chunks.insertBatch, { chunks: batch });
  }

  return { chunksIngested: chunksWithEmbeddings.length, skipped: false };
}

async function main() {
  const args = process.argv.slice(2);
  const client = getConvexClient();
  const config = loadConfig();

  if (config.excludeProjects.length > 0) {
    console.log(`Excluding projects: ${config.excludeProjects.join(", ")}`);
  }
  if (config.excludePatterns.length > 0) {
    console.log(`Redacting ${config.excludePatterns.length} secret patterns`);
  }

  let sessions: SessionInfo[];

  if (args.includes("--all")) {
    console.log("Finding all sessions...");
    sessions = findSessions();
  } else if (args.includes("--since")) {
    const sinceArg = args[args.indexOf("--since") + 1];
    const match = sinceArg?.match(/^(\d+)([dhm])$/);
    if (!match) {
      console.error("Invalid --since format. Use: 7d, 24h, 30m");
      process.exit(1);
    }
    const [, num, unit] = match;
    const ms =
      unit === "d"
        ? parseInt(num) * 86400000
        : unit === "h"
          ? parseInt(num) * 3600000
          : parseInt(num) * 60000;
    const since = Date.now() - ms;
    console.log(`Finding sessions since ${new Date(since).toISOString()}...`);
    sessions = findSessions(since);
  } else if (args.includes("--session")) {
    const sessionId = args[args.indexOf("--session") + 1];
    if (!sessionId) {
      console.error("Provide a session UUID after --session");
      process.exit(1);
    }
    // Find the specific session
    const all = findSessions();
    sessions = all.filter((s) => s.id === sessionId);
    if (sessions.length === 0) {
      console.error(`Session not found: ${sessionId}`);
      process.exit(1);
    }
  } else {
    console.log("Usage:");
    console.log("  npx tsx scripts/sync.ts --all           # Backfill all sessions");
    console.log("  npx tsx scripts/sync.ts --since 7d      # Last 7 days");
    console.log("  npx tsx scripts/sync.ts --session <uuid> # Specific session");
    process.exit(0);
  }

  const total = sessions.length;
  console.log(`Found ${total} sessions to sync.\n`);

  let synced = 0;
  let skipped = 0;
  let errors = 0;
  let totalChunks = 0;
  const startTime = Date.now();

  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i];
    const project = extractProjectName(session.projectPath, config);

    // Progress summary every 50 sessions
    if (i > 0 && i % 50 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      const rate = (synced / (parseFloat(elapsed) || 1)).toFixed(1);
      console.log(
        `\n  [${i}/${total}] ${synced} synced, ${skipped} skipped, ${totalChunks} chunks, ${elapsed}s elapsed (${rate} sessions/s)\n`
      );
    }

    process.stdout.write(
      `  ${session.id} (${project})... `
    );

    try {
      const result = await syncSession(client, session, config);
      if (result.skipped) {
        console.log(`skipped (${result.reason ?? "already ingested or empty"})`);
        skipped++;
      } else {
        console.log(`${result.chunksIngested} chunks ingested`);
        synced++;
        totalChunks += result.chunksIngested;
      }
    } catch (err: any) {
      console.log(`ERROR: ${err.message}`);
      errors++;
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\nDone: ${synced} synced, ${skipped} skipped, ${errors} errors, ${totalChunks} total chunks in ${elapsed}s`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
