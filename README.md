# PAI Memory MCP

Remote MCP memory server for [PAI](https://github.com/buzzwordmojo/claudopilot) — portable, cross-machine AI memory with semantic vector search. Built on [Convex](https://convex.dev).

## How This Relates to PAI's Existing Memory

PAI already has a memory system — the local markdown files in `~/.claude/projects/*/memory/` with frontmatter, managed by Claude Code's built-in hooks. **This project does not replace that.** It augments it.

PAI's local memory is great at what it does: fast, zero-latency, no network dependency, works offline, and Claude Code reads it automatically at session start. This project adds a second layer on top — a remote semantic index that catches everything the local system doesn't.

Think of it like this:

| | PAI Local Memory | PAI Memory MCP |
|---|---|---|
| **What it stores** | Curated memories (the ~1% a hook decides is important) | Everything (all conversation chunks + curated memories) |
| **How you find things** | File paths and MEMORY.md index | Semantic vector search by meaning |
| **Where it lives** | `~/.claude/projects/*/memory/` on one machine | Convex cloud, accessible from any machine |
| **When it's available** | Always, instantly, offline | When you have network access |
| **Who writes to it** | Claude Code via auto-memory hooks | Sync scripts + MCP tools |

They complement each other. Local memory is your fast cache — always there, always loaded. Remote memory is your long-term archive — searchable, portable, complete.

### Tradeoffs

**What you gain by adding this:**
- Memories that work across machines (laptop, desktop, remote servers)
- Semantic search — find things by meaning instead of remembering which file it's in
- Nothing gets lost — raw conversation chunks are stored even if no hook extracts them
- Time-decay ranking — recent memories surface first, old ones fade naturally
- Storage stats and pruning tools to manage growth
- Secret redaction — configurable patterns strip credentials before they reach the cloud

**What it costs:**
- Network dependency for remote search (local memory still works offline)
- ~$0-2/month on Convex after month 6 (free for the first few months)
- Setup time (~10 minutes for initial deploy)
- Sync scripts need to run to backfill existing sessions (one-time)
- Another MCP server in your settings.json (8 additional tools in Claude's context)

**What it does NOT do:**
- Replace or modify your local PAI memory files
- Change how PAI hooks work
- Require any changes to your PAI installation
- Auto-sync in real-time (sessions are synced via script or hook, not live)

## Setup

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- A [Convex](https://www.convex.dev/) account (free Starter plan works)
- [Claude Code](https://claude.ai/code) installed

### 1. Clone and install

```bash
git clone https://github.com/buzzwordmojo/pai-memory-mcp.git
cd pai-memory-mcp
npm install
```

### 2. Create your Convex project

```bash
npx convex dev --configure
```

This opens your browser to authenticate with Convex. Create a new project (e.g., `pai-memory`). Once done, your `.env.local` will be populated with your deployment URLs.

Press `Ctrl+C` after the functions are pushed — you don't need the dev watcher running.

### 3. Run setup

```bash
npm run setup
```

This does everything else automatically:
- Generates a secure auth token and sets it in Convex
- Adds the MCP server to your `~/.claude/settings.json`
- Registers the startup hook for cross-machine memory injection
- Verifies the deployment works

Save the token it prints — you'll need it to configure other machines.

### 4. Import existing memories (optional)

```bash
# Import all memory directories across all projects
CONVEX_URL=<your-convex-url> npx tsx scripts/import-legacy.ts --all

# Backfill session transcripts
CONVEX_URL=<your-convex-url> npx tsx scripts/sync.ts --all
```

Your `CONVEX_URL` is in `.env.local`.

### Manual setup (if you prefer)

<details>
<summary>Click to expand manual steps</summary>

If you'd rather configure things yourself instead of using `npm run setup`:

**Set auth token:**
```bash
openssl rand -base64 32
npx convex env set MEMORY_AUTH_TOKEN "<token>"
```

**Add MCP server to `~/.claude/settings.json`:**
```json
{
  "mcpServers": {
    "pai-memory": {
      "type": "remote",
      "url": "https://<your-deployment>.convex.site/mcp",
      "headers": {
        "Authorization": "Bearer <token>"
      }
    }
  }
}
```

**Register startup hook in `~/.claude/settings.json`:**

Add this to the `hooks.SessionStart` array:
```json
{
  "type": "command",
  "command": "bun /path/to/pai-memory-mcp/scripts/startup-hook.ts"
}
```

**Verify:**
```bash
curl https://<your-deployment>.convex.site/health
```

</details>

## Adding Another Machine

The MCP server is remote — any machine with Claude Code can connect. Just add the same `mcpServers` config to `~/.claude/settings.json` on the new machine (the setup script prints the exact JSON). No install or dependencies needed on the second machine.

To also backfill that machine's existing session transcripts, clone this repo there and run the sync script:

```bash
CONVEX_URL=<your-convex-url> npx tsx scripts/sync.ts --all
```

## How Cross-Machine Memory Works

When you start a session, the startup hook fetches relevant memories from Convex and injects them as context — so Claude on your desktop knows what you learned on your laptop (and vice versa).

```
Desktop session ends → local memory saved → synced to Convex
                                                    ↓
Laptop session starts → startup hook fires → pulls relevant remote memories
                                                    ↓
                                          Claude has full context
                                                    ↓
Laptop session creates local memory → synced to Convex → available everywhere
```

Deduplication prevents the same knowledge from piling up. When a memory is added with an embedding that's >95% similar to an existing memory of the same type, the insert is skipped and the existing memory ID is returned.

## Configuration

### `.pai-memory.json`

Controls what gets synced to the cloud. Place in the project root or `~/`:

```json
{
  "excludeProjects": ["secret-client-work"],
  "excludePatterns": ["sk-[a-zA-Z0-9_-]{20,}", "AKIA[A-Z0-9]{16}"],
  "protectedProjects": ["important-project"]
}
```

| Field | Description |
|-------|-------------|
| `excludeProjects` | Projects whose sessions are never synced to Convex |
| `excludePatterns` | Regex patterns for secrets — matched content is replaced with `[REDACTED]` before upload |
| `protectedProjects` | Projects whose chunks are never pruned |

### Server Settings

Adjustable via `memory_config` MCP tool or Convex environment variables:

| Setting | Default | Env Var | Description |
|---------|---------|---------|-------------|
| Dedup threshold | 0.95 | `DEDUP_THRESHOLD` | Cosine similarity above which a memory is considered a duplicate (0.0-1.0) |
| Decay half-life | 30 days | `DECAY_HALF_LIFE_DAYS` | Time-decay for chunk search ranking. A chunk this many days old scores ~50% of a fresh one |

```bash
# Example: make dedup stricter
npx convex env set DEDUP_THRESHOLD "0.98"

# Example: slower decay (60-day half-life)
npx convex env set DECAY_HALF_LIFE_DAYS "60"
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `memory_search` | Semantic search across all memories and conversation chunks |
| `memory_add` | Store a new memory with automatic dedup and embedding |
| `memory_get` | Retrieve a specific memory by ID |
| `memory_list` | Browse memories with type/project/date filters |
| `memory_graph` | Query entity relationships with temporal awareness |
| `memory_ingest` | Bulk ingest a session transcript (used by sync pipeline) |
| `memory_config` | View or update server settings (dedup threshold, decay half-life) |
| `memory_stats` | Storage statistics — chunk counts by age, memory counts by type, projects |
| `memory_prune` | Delete old non-signal chunks with dry-run mode and project protection |

## Architecture

```
Any Machine                         Convex
┌─────────────────┐                ┌────────────────────────────────┐
│ Claude Code      │               │ Convex Project                 │
│                  │── MCP/HTTP ──▶│                                │
│ settings.json:   │               │  Tables:                       │
│  pai-memory MCP ─┤               │  ├─ chunks (raw text+metadata) │
│                  │◀── results ──│  ├─ memories (curated entries) │
│ CLI sync tool ───┤               │  └─ graph (entity relations)   │
│                  │               │                                │
└─────────────────┘                │  Vector Index:                 │
                                   │  └─ cosine similarity (384d)   │
                                   │                                │
                                   │  HTTP Action:                  │
                                   │  └─ MCP JSON-RPC at /mcp       │
                                   └────────────────────────────────┘
```

## Scripts

```bash
# Sync session transcripts to Convex
npx tsx scripts/sync.ts --all             # All sessions
npx tsx scripts/sync.ts --since 7d        # Last 7 days
npx tsx scripts/sync.ts --session <uuid>  # Specific session

# Import existing PAI memory files
npx tsx scripts/import-legacy.ts --all                # All project memory dirs
npx tsx scripts/import-legacy.ts ~/.claude/MEMORY/    # Specific directory
```

## Cost

Runs on Convex with minimal cost:

| Timeframe | Convex Starter (free plan) | Convex Pro (marginal) |
|-----------|---------------------------|----------------------|
| Month 1-3 | $0.00 | $0.00 |
| Month 12 | $0.95/mo | $0.55/mo |
| Month 24 | $2.28/mo | $1.60/mo |
| 2-year total | $24.74 | $15.44 |

See [COST-ANALYSIS.md](docs/COST-ANALYSIS.md) for full breakdown.

## Documentation

| Document | Description |
|----------|-------------|
| [DESIGN.md](docs/DESIGN.md) | Full technical design — schema, chunking, MCP tools, ingestion pipeline |
| [COST-ANALYSIS.md](docs/COST-ANALYSIS.md) | Platform comparison and cost projections |
| [RESEARCH.md](docs/RESEARCH.md) | MemPalace evaluation and prior art analysis |

## License

MIT
