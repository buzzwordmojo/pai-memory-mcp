import { v } from "convex/values";
import { action } from "./_generated/server";
import { api } from "./_generated/api";
import { Id } from "./_generated/dataModel";

// Defaults — overridable via DECAY_HALF_LIFE_DAYS and DEDUP_THRESHOLD env vars
const DEFAULT_DECAY_HALF_LIFE_DAYS = 30;
const DEFAULT_DEDUP_THRESHOLD = 0.95;

function getDecayHalfLifeMs(): number {
  const days = parseFloat(process.env.DECAY_HALF_LIFE_DAYS ?? "") || DEFAULT_DECAY_HALF_LIFE_DAYS;
  return days * 24 * 60 * 60 * 1000;
}

function getDedupThreshold(): number {
  return parseFloat(process.env.DEDUP_THRESHOLD ?? "") || DEFAULT_DEDUP_THRESHOLD;
}

function applyTimeDecay(score: number, createdAt: number): number {
  const ageMs = Date.now() - createdAt;
  if (ageMs <= 0) return score;
  return score * Math.pow(0.5, ageMs / getDecayHalfLifeMs());
}

interface ChunkSearchResult {
  id: Id<"chunks">;
  content: string;
  type: string;
  score: number;
  createdAt: number;
  project?: string;
  sessionId: string;
  role: string;
  context?: { before: string[]; after: string[] };
}

interface MemorySearchResult {
  id: Id<"memories">;
  content: string;
  title: string;
  type: string;
  subtype?: string;
  score: number;
  createdAt: number;
  project?: string;
  tags?: string[];
}

export const searchChunks = action({
  args: {
    embedding: v.array(v.float64()),
    chunkType: v.optional(v.string()),
    project: v.optional(v.string()),
    limit: v.optional(v.number()),
    includeContext: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<ChunkSearchResult[]> => {
    const limit = args.limit ?? 10;

    const searchArgs: {
      vector: number[];
      limit: number;
      filter?: (q: any) => any;
    } = { vector: args.embedding, limit };

    if (args.chunkType && args.project) {
      searchArgs.filter = (q: any) =>
        q.eq("chunkType", args.chunkType).eq("project", args.project);
    } else if (args.chunkType) {
      searchArgs.filter = (q: any) => q.eq("chunkType", args.chunkType);
    } else if (args.project) {
      searchArgs.filter = (q: any) => q.eq("project", args.project);
    }

    const results = await ctx.vectorSearch("chunks", "by_embedding", searchArgs as any);

    const enriched: (ChunkSearchResult | null)[] = await Promise.all(
      results.map(async (result): Promise<ChunkSearchResult | null> => {
        const chunk = await ctx.runQuery(api.chunks.getById, { id: result._id });
        if (!chunk) return null;

        let context: { before: string[]; after: string[] } | undefined;
        if (args.includeContext !== false && chunk.sessionId) {
          context = await ctx.runQuery(api.chunks.getSurrounding, {
            sessionId: chunk.sessionId,
            sequence: chunk.sequence,
            windowSize: 3,
          });
        }

        return {
          id: chunk._id,
          content: chunk.content,
          type: chunk.chunkType,
          score: applyTimeDecay(result._score, chunk.createdAt),
          createdAt: chunk.createdAt,
          project: chunk.project,
          sessionId: chunk.sessionId,
          role: chunk.role,
          ...(context ? { context } : {}),
        };
      })
    );

    return enriched.filter((r): r is ChunkSearchResult => r !== null);
  },
});

export const searchMemories = action({
  args: {
    embedding: v.array(v.float64()),
    type: v.optional(v.string()),
    project: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<MemorySearchResult[]> => {
    const limit = args.limit ?? 10;

    const searchArgs: {
      vector: number[];
      limit: number;
      filter?: (q: any) => any;
    } = { vector: args.embedding, limit };

    if (args.type && args.project) {
      searchArgs.filter = (q: any) =>
        q.eq("type", args.type).eq("project", args.project);
    } else if (args.type) {
      searchArgs.filter = (q: any) => q.eq("type", args.type);
    } else if (args.project) {
      searchArgs.filter = (q: any) => q.eq("project", args.project);
    }

    const results = await ctx.vectorSearch("memories", "by_embedding", searchArgs as any);

    const enriched: (MemorySearchResult | null)[] = await Promise.all(
      results.map(async (result): Promise<MemorySearchResult | null> => {
        const memory = await ctx.runQuery(api.memories.getById, {
          id: result._id,
        });
        if (!memory) return null;

        if (memory.expiresAt && memory.expiresAt < Date.now()) return null;

        return {
          id: memory._id,
          content: memory.content,
          title: memory.title,
          type: memory.type,
          subtype: memory.subtype,
          score: result._score,
          createdAt: memory.createdAt,
          project: memory.project,
          tags: memory.tags,
        };
      })
    );

    return enriched.filter((r): r is MemorySearchResult => r !== null);
  },
});

export const searchAll = action({
  args: {
    embedding: v.array(v.float64()),
    type: v.optional(v.string()),
    project: v.optional(v.string()),
    limit: v.optional(v.number()),
    includeContext: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<Array<(ChunkSearchResult | MemorySearchResult) & { source: string }>> => {
    const limit = args.limit ?? 10;
    const halfLimit = Math.ceil(limit / 2);

    const [chunkResults, memoryResults] = await Promise.all([
      ctx.runAction(api.search.searchChunks, {
        embedding: args.embedding,
        chunkType: args.type,
        project: args.project,
        limit: halfLimit,
        includeContext: args.includeContext,
      }) as Promise<ChunkSearchResult[]>,
      ctx.runAction(api.search.searchMemories, {
        embedding: args.embedding,
        type: args.type,
        project: args.project,
        limit: halfLimit,
      }) as Promise<MemorySearchResult[]>,
    ]);

    const all = [
      ...chunkResults.map((r) => ({ ...r, source: "chunk" as const })),
      ...memoryResults.map((r) => ({ ...r, source: "memory" as const })),
    ].sort((a, b) => b.score - a.score);

    return all.slice(0, limit);
  },
});

export const findDuplicate = action({
  args: {
    embedding: v.array(v.float64()),
    type: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ isDuplicate: boolean; existingId?: string; existingTitle?: string; score?: number }> => {
    const searchArgs: {
      vector: number[];
      limit: number;
      filter?: (q: any) => any;
    } = { vector: args.embedding, limit: 1 };

    if (args.type) {
      searchArgs.filter = (q: any) => q.eq("type", args.type);
    }

    const results = await ctx.vectorSearch("memories", "by_embedding", searchArgs as any);

    if (results.length === 0 || results[0]._score < getDedupThreshold()) {
      return { isDuplicate: false };
    }

    const existing = await ctx.runQuery(api.memories.getById, { id: results[0]._id });
    if (!existing) return { isDuplicate: false };

    return {
      isDuplicate: true,
      existingId: existing._id,
      existingTitle: existing.title,
      score: results[0]._score,
    };
  },
});
