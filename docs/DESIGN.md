# PAI Memory MCP — Technical Design

## Design Philosophy

**Store everything. Embed selectively. Search semantically.**

Two-tier architecture:
- **Tier 1 — Raw Storage:** Every conversation chunk, verbatim. Nothing discarded.
- **Tier 2 — Semantic Index:** Embeddings of signal-rich chunks only. Tool output, file reads, and scaffolding stored but not embedded.

Search returns high-quality results (no noise), but you can always drill into the raw context around any result.

## Why Convex

Convex was selected after evaluating five platforms. Key advantages:

- **Native vector search** — built into the database, not a separate service
- **HTTP Actions** — MCP server runs as a Convex HTTP endpoint
- **TypeScript-native** — schema, functions, and client all in TS
- **Real-time reactivity** — memories can live-update across clients
- **Auth built-in** — Clerk/Auth0/custom, already solved
- **Familiar** — already used for other projects in the org

See [COST-ANALYSIS.md](COST-ANALYSIS.md) for the full platform comparison.

---

## Convex Schema

### `chunks` — Raw conversation storage (Tier 1)

Every conversation chunk is stored verbatim. This is the "store everything" layer.

```typescript
// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  chunks: defineTable({
    sessionId: v.string(),        // claude code session uuid
    project: v.optional(v.string()), // project context (e.g., "scrapcycle")
    sequence: v.number(),         // order within session
    role: v.string(),             // 'user' | 'assistant' | 'tool_result' | 'system'
    content: v.string(),          // raw text, verbatim
    chunkType: v.string(),        // 'conversation' | 'tool_call' | 'tool_result' | 'decision' | 'learning'
    isSignal: v.boolean(),        // true = embedded for search
    tokensApprox: v.optional(v.number()),
    embedding: v.optional(v.array(v.float64())), // 384-dim, only for signal chunks
    metadata: v.optional(v.string()), // JSON: tool names, file paths, error flags
    createdAt: v.number(),        // unix timestamp ms
  })
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 384,
      filterFields: ["chunkType", "project"],
    })
    .index("by_session", ["sessionId", "sequence"])
    .index("by_project", ["project", "createdAt"])
    .index("by_type", ["chunkType", "createdAt"])
    .index("by_created", ["createdAt"]),

  memories: defineTable({
    type: v.string(),             // 'user' | 'feedback' | 'project' | 'reference' | 'learning' | 'work'
    subtype: v.optional(v.string()), // 'system' | 'algorithm' | 'reflection'
    title: v.string(),
    content: v.string(),
    embedding: v.optional(v.array(v.float64())),
    sourceChunkId: v.optional(v.id("chunks")),
    sourceSessionId: v.optional(v.string()),
    project: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    supersedes: v.optional(v.id("memories")),
    expiresAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 384,
      filterFields: ["type", "project"],
    })
    .index("by_type", ["type", "subtype", "createdAt"])
    .index("by_project", ["project", "createdAt"])
    .index("by_created", ["createdAt"]),

  graph: defineTable({
    subject: v.string(),          // entity name
    predicate: v.string(),        // relationship type
    object: v.string(),           // target entity
    confidence: v.number(),       // 0-1
    sourceMemoryId: v.optional(v.id("memories")),
    validFrom: v.number(),        // unix timestamp ms
    validUntil: v.optional(v.number()),
  })
    .index("by_subject", ["subject", "predicate"])
    .index("by_object", ["object", "predicate"])
    .index("by_predicate", ["predicate"]),
});
```

---

## Chunking Strategy

Raw session JSONL is split into semantic chunks, not fixed-size blocks:

| Source | Chunk Type | Embedded? | Why |
|--------|-----------|-----------|-----|
| User messages | `conversation` | Yes | Direct signal — questions, requests, context |
| Assistant reasoning | `conversation` | Yes | Decisions, explanations, recommendations |
| Tool calls (code written) | `tool_call` | Yes (code only) | What was built/changed |
| Tool results (file reads) | `tool_result` | No | Noise — reproducible by re-reading files |
| Tool results (errors) | `tool_result` | Yes | Errors are learnings |
| System messages | `system` | No | Scaffolding |
| PRD content | `decision` | Yes | Decisions and criteria |
| Learning files | `learning` | Yes | Extracted insights |

### Chunking Rules

- **Max chunk:** 512 tokens (embedding model context window)
- **User + assistant pair:** Combined into single chunk when < 512 tokens
- **Long responses:** Split at paragraph boundaries
- **Tool results > 200 tokens:** Store verbatim, don't embed (except errors)
- **Consecutive system messages:** Collapse into one chunk, don't embed

### Signal Classification

~20% of chunks are classified as "signal" and get embedded. The rest are stored raw for context drill-down. This ratio keeps search quality high while preserving everything.

---

## Embedding Strategy

- **Model:** External embedding API (OpenAI `text-embedding-3-small` or similar)
- **Dimensions:** 384
- **Pre-embedding:** Embeddings are generated client-side before sending to Convex, keeping Convex action compute minimal
- **Convex vector search:** Uses native `vectorSearch()` with cosine similarity

### Why Pre-Embed Client-Side?

Convex vector search requires vectors to be stored in the document — it searches, it doesn't embed. Generating embeddings in a Convex action would consume action compute budget. Pre-embedding on the local machine (which has plenty of compute) keeps Convex costs to pure storage + queries.

---

## MCP Tools

### `memory_search(query, options?)`

Semantic search across all embedded chunks and memories.

```typescript
// Parameters
query: string              // natural language query (will be embedded client-side)
options?: {
  type?: string            // filter: 'conversation' | 'learning' | 'decision' | 'work' | 'user' | 'feedback'
  project?: string         // filter by project
  since?: string           // ISO date, only results after this
  until?: string           // ISO date, only results before this
  limit?: number           // max results (default 10)
  includeContext?: boolean // include surrounding chunks (default true)
}

// Returns
results: [{
  id: string
  content: string          // the matching chunk/memory
  type: string
  score: number            // cosine similarity score
  createdAt: string
  project?: string
  context?: {              // surrounding chunks if includeContext=true
    before: string[]
    after: string[]
  }
}]
```

### `memory_add(content, type, options?)`

Store a new memory with embedding.

```typescript
content: string
type: 'user' | 'feedback' | 'project' | 'reference' | 'learning' | 'work'
options?: {
  subtype?: string
  title?: string           // auto-generated if omitted
  project?: string
  tags?: string[]
  sourceSessionId?: string
  supersedes?: string      // id of memory this replaces
  expiresAt?: string       // TTL
  embedding?: number[]     // pre-computed 384-dim vector
}
```

### `memory_get(id)`

Retrieve a specific memory or chunk by ID.

### `memory_list(options?)`

Browse memories with filters (type, project, date range, limit).

### `memory_graph(query, options?)`

Query the knowledge graph.

```typescript
query: string              // entity name or relationship query
options?: {
  direction?: 'outgoing' | 'incoming' | 'both'
  hops?: number            // traversal depth (default 1, max 3)
  asOf?: string            // temporal query — state at this date
}
```

### `memory_ingest(sessionData)`

Bulk ingest a session transcript. Used by the sync pipeline.

```typescript
sessionData: {
  sessionId: string
  project?: string
  chunks: [{               // pre-chunked and pre-embedded by the sync script
    role: string
    content: string
    chunkType: string
    isSignal: boolean
    sequence: number
    embedding?: number[]   // 384-dim, only for signal chunks
    metadata?: string      // JSON string
    createdAt: number
  }]
}
```

---

## Ingestion Pipeline

### Automated (preferred)

A PAI hook fires on `SessionEnd`:

1. Reads the session JSONL from `~/.claude/projects/`
2. Chunks it using the rules above
3. Generates embeddings for signal chunks (local or API)
4. Calls `memory_ingest()` on the Convex HTTP Action

### Manual / Backfill

```bash
# Sync all sessions from last 7 days
npx tsx scripts/sync.ts --since 7d

# Backfill everything (first-time setup)
npx tsx scripts/sync.ts --all

# Sync a specific session
npx tsx scripts/sync.ts --session <uuid>

# Import existing PAI MEMORY/ files
npx tsx scripts/import-legacy.ts ~/.claude/MEMORY/
```

The sync script handles:
- Reading JSONL from `~/.claude/projects/`
- Chunking per the strategy above
- Embedding generation (batched)
- Deduplication (skip already-ingested sessions via sessionId index)

---

## Sync Strategy

**Primary: Push on SessionEnd** — PAI hook sends session data to Convex when it ends.

**Fallback: CLI sync** — for machines without the hook, or for backfilling. Idempotent.

**Conflict resolution:** Append-only for chunks (immutable). Memories use `supersedes` for updates — never overwrite, always create new version. No conflicts possible.

---

## Authentication

For community deployment, two options:

### Single-User (Simple)

Bearer token stored in environment variable:

```
CONVEX_MEMORY_TOKEN=<random-secret>
```

- Set as Convex environment variable
- HTTP Action validates on every request
- Token stored locally in `~/.pai-memory/token`

### Multi-User (Clerk/Auth0)

Standard Convex auth integration. Each user's memories are isolated by userId.

---

## Context Injection

When Claude Code starts a session, a startup hook calls `memory_search` with:
- Current project name
- Recent conversation topics (from CLAUDE.md context)

Results are injected as a system reminder, similar to CLAUDE.md loading.

**Token budget:** Max 2,000 tokens of injected context per session start.

**On-demand:** Claude can call `memory_search` directly via MCP during a session.

---

## Retention / Lifecycle

| Data | Retention | Rationale |
|------|-----------|-----------|
| Raw chunks | Forever | They're small; total recall is the point |
| Signal embeddings | Forever | Search index, grows slowly |
| Curated memories | Forever unless superseded | Old versions kept, excluded from search |
| Graph relationships | Until `validUntil` set | Temporal validity built in |
| Expired memories | Soft delete after `expiresAt` | Excluded from search, kept in DB |

---

## Migration Path

### Phase 1: Deploy + Backfill
1. `npx convex dev` to create project
2. Run `import-legacy.ts` for existing MEMORY/ files
3. Run `sync.ts --all` for available transcripts

### Phase 2: Hook Integration
1. Add SessionEnd hook for automatic ingestion
2. Add startup hook for context injection
3. Test on primary machine

### Phase 3: Multi-Machine
1. Configure auth token on second machine
2. Add MCP server to Claude Code settings
3. Verify cross-machine memory access

### Phase 4: Community Release
1. Documentation for self-deployment
2. One-command setup script
3. Optional: hosted shared instance for PAI community
