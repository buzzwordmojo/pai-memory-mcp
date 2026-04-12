#!/usr/bin/env npx tsx
/**
 * PAI Memory MCP — Setup Script
 *
 * Automates post-deploy configuration:
 * 1. Generates auth token
 * 2. Sets it as Convex env var
 * 3. Adds MCP server to ~/.claude/settings.json
 * 4. Registers the startup hook
 *
 * Usage:
 *   npx tsx scripts/setup.ts
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { randomBytes } from "crypto";
import * as os from "os";

const CLAUDE_DIR = join(os.homedir(), ".claude");
const SETTINGS_PATH = join(CLAUDE_DIR, "settings.json");

function generateToken(): string {
  return randomBytes(32).toString("base64");
}

function readEnvLocal(): Record<string, string> {
  const envPath = join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return {};
  const vars: Record<string, string> = {};
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    if (line.startsWith("#") || !line.includes("=")) continue;
    const [key, ...rest] = line.split("=");
    vars[key.trim()] = rest.join("=").trim();
  }
  return vars;
}

function loadSettings(): any {
  if (!existsSync(SETTINGS_PATH)) return {};
  return JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
}

function saveSettings(settings: any): void {
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
}

async function main() {
  console.log("PAI Memory MCP — Setup\n");

  // Step 1: Check Convex deployment
  const env = readEnvLocal();
  const convexUrl = env.CONVEX_URL;
  const siteUrl = env.CONVEX_SITE_URL;

  if (!convexUrl || !siteUrl) {
    console.error("Error: No Convex deployment found.");
    console.error("Run `npx convex dev --configure` first to create your project.");
    process.exit(1);
  }

  console.log(`Convex deployment: ${convexUrl}`);
  console.log(`MCP endpoint: ${siteUrl}/mcp\n`);

  // Step 2: Generate and set auth token
  const token = generateToken();
  console.log("Setting auth token...");
  try {
    execSync(`npx convex env set MEMORY_AUTH_TOKEN "${token}"`, {
      stdio: "pipe",
    });
    console.log("  Auth token set in Convex.\n");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`  Failed to set env var: ${msg}`);
    console.error("  You can set it manually: npx convex env set MEMORY_AUTH_TOKEN \"<token>\"");
    process.exit(1);
  }

  // Step 3: Add MCP server to settings.json
  console.log("Configuring Claude Code settings...");
  const settings = loadSettings();

  if (!settings.mcpServers) settings.mcpServers = {};

  const existingServer = settings.mcpServers["pai-memory"];
  if (existingServer) {
    console.log("  pai-memory MCP server already configured — updating...");
  }

  settings.mcpServers["pai-memory"] = {
    type: "remote",
    url: `${siteUrl}/mcp`,
    headers: {
      Authorization: `Bearer ${token}`,
    },
  };

  // Step 4: Register startup hook
  if (!settings.hooks) settings.hooks = {};
  if (!settings.hooks.SessionStart) settings.hooks.SessionStart = [];

  const hookCommand = `bun ${join(process.cwd(), "scripts/startup-hook.ts")}`;
  const hookEntry = settings.hooks.SessionStart as any[];

  // Find existing hook block or create new one
  let hookBlock = hookEntry.find(
    (block: any) =>
      block.hooks?.some((h: any) => h.command?.includes("startup-hook.ts"))
  );

  if (hookBlock) {
    console.log("  Startup hook already registered — updating...");
    const hook = hookBlock.hooks.find((h: any) =>
      h.command?.includes("startup-hook.ts")
    );
    if (hook) hook.command = hookCommand;
  } else {
    // Append to the existing SessionStart hooks block if there is one
    if (hookEntry.length > 0 && hookEntry[0].hooks) {
      hookEntry[0].hooks.push({
        type: "command",
        command: hookCommand,
      });
    } else {
      hookEntry.push({
        hooks: [
          {
            type: "command",
            command: hookCommand,
          },
        ],
      });
    }
  }

  saveSettings(settings);
  console.log("  MCP server added to ~/.claude/settings.json");
  console.log("  Startup hook registered.\n");

  // Step 5: Verify
  console.log("Verifying...");
  try {
    const res = await fetch(`${siteUrl}/health`);
    const data = (await res.json()) as any;
    if (data.status === "ok") {
      console.log("  Health check: OK");
    } else {
      console.log("  Health check: unexpected response", data);
    }
  } catch {
    console.log("  Health check: failed (server may still be deploying)");
  }

  try {
    const res = await fetch(`${siteUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      }),
    });
    const data = (await res.json()) as any;
    const toolCount = data.result?.tools?.length ?? 0;
    console.log(`  MCP auth: OK (${toolCount} tools available)`);
  } catch {
    console.log("  MCP auth: failed");
  }

  console.log("\n Setup complete!\n");
  console.log("Your token (save this if you need to configure other machines):");
  console.log(`  ${token}\n`);
  console.log("To add another machine, add this to its ~/.claude/settings.json:");
  console.log(`  "pai-memory": {`);
  console.log(`    "type": "remote",`);
  console.log(`    "url": "${siteUrl}/mcp",`);
  console.log(`    "headers": { "Authorization": "Bearer ${token}" }`);
  console.log(`  }\n`);
  console.log("Optional next steps:");
  console.log("  npx tsx scripts/import-legacy.ts --all    # Import existing memories");
  console.log("  npx tsx scripts/sync.ts --all             # Backfill session transcripts");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
