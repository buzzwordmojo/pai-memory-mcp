#!/usr/bin/env bun
/**
 * PAI Memory MCP — SessionStart hook
 *
 * Fetches relevant remote memories from Convex at session start and injects
 * them as context. Reads MCP server config from ~/.claude/settings.json.
 *
 * TRIGGER: SessionStart (register in settings.json hooks)
 * OUTPUT: stdout — <system-reminder> with remote memory context
 * PERFORMANCE: Non-blocking target <500ms, graceful timeout at 3s
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";

const MAX_RESULTS = 5;
const MAX_TOKENS = 2000; // budget for injected context
const TIMEOUT_MS = 3000;

interface McpServerConfig {
  type?: string;
  url?: string;
  headers?: Record<string, string>;
}

interface Settings {
  mcpServers?: Record<string, McpServerConfig>;
  [key: string]: unknown;
}

function loadSettings(): Settings {
  const settingsPath = join(
    process.env.HOME || process.env.USERPROFILE || "~",
    ".claude",
    "settings.json"
  );
  if (!existsSync(settingsPath)) return {};
  try {
    return JSON.parse(readFileSync(settingsPath, "utf-8"));
  } catch {
    return {};
  }
}

function getMcpConfig(settings: Settings): { url: string; token: string } | null {
  const server = settings.mcpServers?.["pai-memory"];
  if (!server?.url) return null;

  const authHeader = server.headers?.["Authorization"] ?? "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : authHeader;

  if (!token) return null;
  return { url: server.url, token };
}

function getCurrentProject(): string | undefined {
  // CLAUDE_PROJECT_DIR is set by Claude Code, e.g., "-home-bob-projects-myproject"
  const projectDir = process.env.CLAUDE_PROJECT_DIR;
  if (!projectDir) return undefined;
  const parts = projectDir.split("-").filter(Boolean);
  return parts[parts.length - 1] || undefined;
}

async function mcpToolCall(
  url: string,
  token: string,
  tool: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: tool, arguments: args },
      }),
      signal: controller.signal,
    });

    const data = (await res.json()) as any;
    if (data.error) return null;
    return JSON.parse(data.result.content[0].text);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function truncateToTokenBudget(text: string, maxTokens: number): string {
  // ~4 chars per token
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "\n[...truncated]";
}

async function main() {
  // Skip for subagents
  const claudeProjectDir = process.env.CLAUDE_PROJECT_DIR || "";
  if (
    claudeProjectDir.includes("/.claude/Agents/") ||
    process.env.CLAUDE_AGENT_TYPE !== undefined
  ) {
    process.exit(0);
  }

  const settings = loadSettings();
  const config = getMcpConfig(settings);
  if (!config) {
    console.error("⏭️ PAI Memory MCP: not configured, skipping");
    process.exit(0);
  }

  const project = getCurrentProject();

  // Fetch recent memories relevant to this project
  const listArgs: Record<string, unknown> = { limit: MAX_RESULTS };
  if (project) listArgs.project = project;

  const memories = (await mcpToolCall(
    config.url,
    config.token,
    "memory_list",
    listArgs
  )) as any[] | null;

  if (!memories || memories.length === 0) {
    console.error(
      `📡 PAI Memory MCP: no remote memories found${project ? ` for ${project}` : ""}`
    );
    process.exit(0);
  }

  // Format for injection
  const lines: string[] = [];
  lines.push(
    `## Remote Memory Context (${memories.length} memories${project ? `, project: ${project}` : ""})`
  );
  lines.push("");

  for (const m of memories) {
    const typeTag = m.type ? `[${m.type}]` : "";
    const date = m.createdAt
      ? new Date(m.createdAt).toISOString().split("T")[0]
      : "";
    lines.push(`**${m.title}** ${typeTag} ${date}`);
    lines.push(m.content);
    lines.push("");
  }

  lines.push(
    "*Remote memories from PAI Memory MCP. Use `memory_search` for semantic search across all stored context.*"
  );

  const content = truncateToTokenBudget(lines.join("\n"), MAX_TOKENS);

  console.log(`<system-reminder>\n${content}\n</system-reminder>`);
  console.error(
    `📡 PAI Memory MCP: injected ${memories.length} remote memories (${content.length} chars)`
  );

  process.exit(0);
}

main();
