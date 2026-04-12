import { ActionCtx } from "../_generated/server";
import { api } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import {
  JsonRpcRequest,
  JsonRpcResponse,
  McpToolResult,
  MCP_SERVER_INFO,
} from "./types";
import { TOOL_DEFINITIONS } from "./tools";

export async function handleMcpRequest(
  ctx: ActionCtx,
  request: JsonRpcRequest
): Promise<JsonRpcResponse> {
  try {
    switch (request.method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            protocolVersion: MCP_SERVER_INFO.protocolVersion,
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: MCP_SERVER_INFO.name,
              version: MCP_SERVER_INFO.version,
            },
          },
        };

      case "notifications/initialized":
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: {},
        };

      case "tools/list":
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: { tools: TOOL_DEFINITIONS },
        };

      case "tools/call":
        return await handleToolCall(ctx, request);

      case "ping":
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: {},
        };

      default:
        return {
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: -32601,
            message: `Method not found: ${request.method}`,
          },
        };
    }
  } catch (err: unknown) {
    return {
      jsonrpc: "2.0",
      id: request.id,
      error: {
        code: -32603,
        message: err instanceof Error ? err.message : "Internal error",
      },
    };
  }
}

async function handleToolCall(
  ctx: ActionCtx,
  request: JsonRpcRequest
): Promise<JsonRpcResponse> {
  const params = request.params as {
    name: string;
    arguments?: Record<string, unknown>;
  };
  const toolName = params?.name;
  const args = params?.arguments ?? {};

  let result: McpToolResult;

  switch (toolName) {
    case "memory_search":
      result = await toolMemorySearch(ctx, args);
      break;
    case "memory_add":
      result = await toolMemoryAdd(ctx, args);
      break;
    case "memory_get":
      result = await toolMemoryGet(ctx, args);
      break;
    case "memory_list":
      result = await toolMemoryList(ctx, args);
      break;
    case "memory_graph":
      result = await toolMemoryGraph(ctx, args);
      break;
    case "memory_ingest":
      result = await toolMemoryIngest(ctx, args);
      break;
    case "memory_config":
      result = await toolMemoryConfig(ctx, args);
      break;
    case "memory_stats":
      result = await toolMemoryStats(ctx);
      break;
    case "memory_prune":
      result = await toolMemoryPrune(ctx, args);
      break;
    default:
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32602, message: `Unknown tool: ${toolName}` },
      };
  }

  return {
    jsonrpc: "2.0",
    id: request.id,
    result: result,
  };
}

// --- Tool Implementations ---

async function toolMemorySearch(
  ctx: ActionCtx,
  args: Record<string, unknown>
): Promise<McpToolResult> {
  const embedding = args.embedding as number[];
  if (!embedding || !Array.isArray(embedding)) {
    return errorResult("embedding is required and must be an array of numbers");
  }

  const results = await ctx.runAction(api.search.searchAll, {
    embedding,
    type: args.type as string | undefined,
    project: args.project as string | undefined,
    limit: args.limit as number | undefined,
    includeContext: args.includeContext as boolean | undefined,
  });

  // Apply date filters client-side if provided
  let filtered = results as any[];
  if (args.since) {
    filtered = filtered.filter((r) => r.createdAt >= (args.since as number));
  }
  if (args.until) {
    filtered = filtered.filter((r) => r.createdAt <= (args.until as number));
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(filtered, null, 2),
      },
    ],
  };
}

async function toolMemoryAdd(
  ctx: ActionCtx,
  args: Record<string, unknown>
): Promise<McpToolResult> {
  const content = args.content as string;
  const type = args.type as string;
  const title = args.title as string;

  if (!content || !type || !title) {
    return errorResult("content, type, and title are required");
  }

  const embedding = args.embedding as number[] | undefined;

  // Dedup check: if embedding provided, look for near-duplicates
  if (embedding && !args.supersedes) {
    const dedup = await ctx.runAction(api.search.findDuplicate, {
      embedding,
      type,
    });

    if (dedup.isDuplicate && dedup.existingId) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              id: dedup.existingId,
              status: "deduplicated",
              existingTitle: dedup.existingTitle,
              score: dedup.score,
            }),
          },
        ],
      };
    }
  }

  const id = await ctx.runMutation(api.memories.insert, {
    content,
    type,
    title,
    embedding,
    subtype: args.subtype as string | undefined,
    project: args.project as string | undefined,
    tags: args.tags as string[] | undefined,
    sourceSessionId: args.sourceSessionId as string | undefined,
    supersedes: args.supersedes as Id<"memories"> | undefined,
    expiresAt: args.expiresAt as number | undefined,
  });

  return {
    content: [{ type: "text", text: JSON.stringify({ id, status: "created" }) }],
  };
}

async function toolMemoryGet(
  ctx: ActionCtx,
  args: Record<string, unknown>
): Promise<McpToolResult> {
  const id = args.id as string;
  const table = (args.table as string) ?? "memories";

  if (!id) {
    return errorResult("id is required");
  }

  let doc;
  if (table === "chunks") {
    doc = await ctx.runQuery(api.chunks.getById, {
      id: id as Id<"chunks">,
    });
  } else {
    doc = await ctx.runQuery(api.memories.getById, {
      id: id as Id<"memories">,
    });
  }

  if (!doc) {
    return errorResult(`Not found: ${id}`);
  }

  return {
    content: [{ type: "text", text: JSON.stringify(doc, null, 2) }],
  };
}

async function toolMemoryList(
  ctx: ActionCtx,
  args: Record<string, unknown>
): Promise<McpToolResult> {
  const results = await ctx.runQuery(api.memories.list, {
    type: args.type as string | undefined,
    subtype: args.subtype as string | undefined,
    project: args.project as string | undefined,
    since: args.since as number | undefined,
    until: args.until as number | undefined,
    limit: args.limit as number | undefined,
  });

  return {
    content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
  };
}

async function toolMemoryGraph(
  ctx: ActionCtx,
  args: Record<string, unknown>
): Promise<McpToolResult> {
  const entity = args.entity as string;
  if (!entity) {
    return errorResult("entity is required");
  }

  const edges = await ctx.runQuery(api.graph.traverse, {
    entity,
    direction: args.direction as string | undefined,
    hops: args.hops as number | undefined,
    asOf: args.asOf as number | undefined,
  });

  return {
    content: [{ type: "text", text: JSON.stringify(edges, null, 2) }],
  };
}

async function toolMemoryIngest(
  ctx: ActionCtx,
  args: Record<string, unknown>
): Promise<McpToolResult> {
  const sessionId = args.sessionId as string;
  const chunks = args.chunks as Array<Record<string, unknown>>;

  if (!sessionId || !chunks || !Array.isArray(chunks)) {
    return errorResult("sessionId and chunks array are required");
  }

  // Check if session already ingested
  const exists = await ctx.runQuery(api.chunks.sessionExists, { sessionId });
  if (exists) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "skipped",
            reason: "session already ingested",
            sessionId,
          }),
        },
      ],
    };
  }

  // Insert chunks in batches of 50 (Convex mutation size limits)
  const BATCH_SIZE = 50;
  let totalInserted = 0;

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE).map((chunk) => ({
      sessionId,
      project: args.project as string | undefined,
      sequence: chunk.sequence as number,
      role: chunk.role as string,
      content: chunk.content as string,
      chunkType: chunk.chunkType as string,
      isSignal: chunk.isSignal as boolean,
      tokensApprox: chunk.tokensApprox as number | undefined,
      embedding: chunk.embedding as number[] | undefined,
      metadata: chunk.metadata as string | undefined,
      createdAt: chunk.createdAt as number,
    }));

    await ctx.runMutation(api.chunks.insertBatch, { chunks: batch });
    totalInserted += batch.length;
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          status: "ingested",
          sessionId,
          chunksInserted: totalInserted,
        }),
      },
    ],
  };
}

async function toolMemoryConfig(
  ctx: ActionCtx,
  args: Record<string, unknown>
): Promise<McpToolResult> {
  const current = {
    dedupThreshold: parseFloat(process.env.DEDUP_THRESHOLD ?? "") || 0.95,
    decayHalfLifeDays: parseFloat(process.env.DECAY_HALF_LIFE_DAYS ?? "") || 30,
  };

  const hasUpdates =
    args.dedupThreshold !== undefined || args.decayHalfLifeDays !== undefined;

  if (!hasUpdates) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              ...current,
              note: "To update, call memory_config with dedupThreshold and/or decayHalfLifeDays. Changes are applied via Convex environment variables (npx convex env set).",
            },
            null,
            2
          ),
        },
      ],
    };
  }

  // Report what should be changed — we can't set env vars from an action,
  // but we can tell the user the commands to run
  const commands: string[] = [];
  const updated = { ...current };

  if (args.dedupThreshold !== undefined) {
    const val = args.dedupThreshold as number;
    if (val < 0 || val > 1) {
      return errorResult("dedupThreshold must be between 0.0 and 1.0");
    }
    updated.dedupThreshold = val;
    commands.push(`npx convex env set DEDUP_THRESHOLD "${val}"`);
  }

  if (args.decayHalfLifeDays !== undefined) {
    const val = args.decayHalfLifeDays as number;
    if (val <= 0) {
      return errorResult("decayHalfLifeDays must be positive");
    }
    updated.decayHalfLifeDays = val;
    commands.push(`npx convex env set DECAY_HALF_LIFE_DAYS "${val}"`);
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            current,
            requested: updated,
            commands,
            note: "Run these commands in the pai-memory-mcp directory to apply changes. They take effect immediately — no redeployment needed.",
          },
          null,
          2
        ),
      },
    ],
  };
}

async function toolMemoryStats(
  ctx: ActionCtx
): Promise<McpToolResult> {
  const stats = await ctx.runQuery(api.prune.getStorageStats, {});
  return {
    content: [{ type: "text", text: JSON.stringify(stats, null, 2) }],
  };
}

async function toolMemoryPrune(
  ctx: ActionCtx,
  args: Record<string, unknown>
): Promise<McpToolResult> {
  const maxAgeDays = (args.maxAgeDays as number) ?? 90;
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const protectedProjects = (args.protectedProjects as string[]) ?? [];
  const dryRun = (args.dryRun as boolean) ?? false;

  if (dryRun) {
    const preview = await ctx.runQuery(api.prune.findPrunableChunks, {
      maxAgeMs,
      protectedProjects,
      limit: 100,
    });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            dryRun: true,
            prunableCount: preview.total,
            maxAgeDays,
            protectedProjects,
            sample: preview.chunks.slice(0, 10),
          }, null, 2),
        },
      ],
    };
  }

  const result = await ctx.runMutation(api.prune.pruneOldChunks, {
    maxAgeMs,
    protectedProjects,
  });

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          ...result,
          maxAgeDays,
          protectedProjects,
        }, null, 2),
      },
    ],
  };
}

function errorResult(message: string): McpToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}
