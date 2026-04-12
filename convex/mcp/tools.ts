import { McpToolDefinition } from "./types";

export const TOOL_DEFINITIONS: McpToolDefinition[] = [
  {
    name: "memory_search",
    description:
      "Semantic search across all memories and conversation chunks. Returns ranked results with optional surrounding context.",
    inputSchema: {
      type: "object",
      properties: {
        embedding: {
          type: "array",
          items: { type: "number" },
          description:
            "Pre-computed 384-dim embedding vector of the search query",
        },
        type: {
          type: "string",
          description:
            "Filter by type: 'conversation' | 'learning' | 'decision' | 'work' | 'user' | 'feedback' | 'reference' | 'tool_call' | 'tool_result'",
        },
        project: {
          type: "string",
          description: "Filter by project name",
        },
        since: {
          type: "number",
          description: "Only results after this unix timestamp (ms)",
        },
        until: {
          type: "number",
          description: "Only results before this unix timestamp (ms)",
        },
        limit: {
          type: "number",
          description: "Max results to return (default 10)",
        },
        includeContext: {
          type: "boolean",
          description:
            "Include surrounding chunks for context window (default true)",
        },
      },
      required: ["embedding"],
    },
  },
  {
    name: "memory_add",
    description:
      "Store a new memory with automatic timestamping. Provide a pre-computed embedding for semantic search.",
    inputSchema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "The memory content",
        },
        type: {
          type: "string",
          description:
            "Memory type: 'user' | 'feedback' | 'project' | 'reference' | 'learning' | 'work'",
        },
        title: {
          type: "string",
          description: "Short title for the memory",
        },
        embedding: {
          type: "array",
          items: { type: "number" },
          description: "Pre-computed 384-dim embedding vector",
        },
        subtype: { type: "string", description: "Optional subtype" },
        project: { type: "string", description: "Project name" },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags for categorization",
        },
        sourceSessionId: { type: "string", description: "Source session UUID" },
        supersedes: {
          type: "string",
          description: "ID of memory this replaces",
        },
        expiresAt: {
          type: "number",
          description: "Unix timestamp (ms) when this memory expires",
        },
      },
      required: ["content", "type", "title"],
    },
  },
  {
    name: "memory_get",
    description: "Retrieve a specific memory or chunk by its Convex ID.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Convex document ID",
        },
        table: {
          type: "string",
          description: "Table to look up: 'memories' (default) or 'chunks'",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "memory_list",
    description:
      "Browse memories with type, project, and date filters. Returns newest first.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", description: "Filter by memory type" },
        subtype: { type: "string", description: "Filter by subtype" },
        project: { type: "string", description: "Filter by project" },
        since: {
          type: "number",
          description: "Only results after this unix timestamp (ms)",
        },
        until: {
          type: "number",
          description: "Only results before this unix timestamp (ms)",
        },
        limit: {
          type: "number",
          description: "Max results (default 50)",
        },
      },
    },
  },
  {
    name: "memory_graph",
    description:
      "Query the knowledge graph for entity relationships. Supports multi-hop traversal and temporal queries.",
    inputSchema: {
      type: "object",
      properties: {
        entity: {
          type: "string",
          description: "Entity name to query",
        },
        direction: {
          type: "string",
          description: "'outgoing' | 'incoming' | 'both' (default 'both')",
        },
        hops: {
          type: "number",
          description: "Traversal depth (default 1, max 3)",
        },
        asOf: {
          type: "number",
          description:
            "Temporal query — return state at this unix timestamp (ms)",
        },
      },
      required: ["entity"],
    },
  },
  {
    name: "memory_ingest",
    description:
      "Bulk ingest a session transcript. Chunks should be pre-chunked and pre-embedded. Idempotent — skips already-ingested sessions.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Session UUID" },
        project: { type: "string", description: "Project name" },
        chunks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              role: { type: "string" },
              content: { type: "string" },
              chunkType: { type: "string" },
              isSignal: { type: "boolean" },
              sequence: { type: "number" },
              embedding: {
                type: "array",
                items: { type: "number" },
              },
              metadata: { type: "string" },
              createdAt: { type: "number" },
            },
            required: [
              "role",
              "content",
              "chunkType",
              "isSignal",
              "sequence",
              "createdAt",
            ],
          },
          description: "Pre-chunked and pre-embedded session data",
        },
      },
      required: ["sessionId", "chunks"],
    },
  },
  {
    name: "memory_config",
    description:
      "View or update server configuration. Without arguments, returns current settings. With arguments, updates the specified settings via Convex environment variables.",
    inputSchema: {
      type: "object",
      properties: {
        dedupThreshold: {
          type: "number",
          description:
            "Cosine similarity threshold for memory deduplication (0.0-1.0, default 0.95). Higher = stricter dedup.",
        },
        decayHalfLifeDays: {
          type: "number",
          description:
            "Time-decay half-life in days for chunk search ranking (default 30). A 30-day-old chunk scores ~50% of an identical fresh one.",
        },
      },
    },
  },
  {
    name: "memory_stats",
    description:
      "Get storage statistics: chunk counts (signal vs non-signal, by age), memory counts by type, graph size, and project list.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "memory_prune",
    description:
      "Delete non-signal chunks older than a threshold. Signal chunks (embedded for search) and curated memories are never deleted. Specific projects can be protected from pruning.",
    inputSchema: {
      type: "object",
      properties: {
        maxAgeDays: {
          type: "number",
          description: "Delete non-signal chunks older than this many days (default 90)",
        },
        protectedProjects: {
          type: "array",
          items: { type: "string" },
          description: "Projects whose chunks should never be pruned",
        },
        dryRun: {
          type: "boolean",
          description: "If true, report what would be pruned without deleting (default false)",
        },
      },
    },
  },
];
