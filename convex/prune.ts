import { v } from "convex/values";
import { mutation, query, action } from "./_generated/server";
import { api } from "./_generated/api";

const DEFAULT_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

export const findPrunableChunks = query({
  args: {
    maxAgeMs: v.optional(v.number()),
    protectedProjects: v.optional(v.array(v.string())),
    dryRun: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const maxAge = args.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    const cutoff = Date.now() - maxAge;
    const protectedProjects = new Set(args.protectedProjects ?? []);
    const limit = args.limit ?? 1000;

    const oldChunks = await ctx.db
      .query("chunks")
      .withIndex("by_created")
      .order("asc")
      .collect();

    const prunable = oldChunks.filter((chunk) => {
      if (chunk.createdAt >= cutoff) return false;
      if (chunk.isSignal) return false;
      if (chunk.project && protectedProjects.has(chunk.project)) return false;
      return true;
    });

    return {
      total: prunable.length,
      chunks: prunable.slice(0, limit).map((c) => ({
        id: c._id,
        sessionId: c.sessionId,
        project: c.project,
        chunkType: c.chunkType,
        createdAt: c.createdAt,
        contentPreview: c.content.slice(0, 80),
      })),
    };
  },
});

export const pruneOldChunks = mutation({
  args: {
    maxAgeMs: v.optional(v.number()),
    protectedProjects: v.optional(v.array(v.string())),
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const maxAge = args.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    const cutoff = Date.now() - maxAge;
    const protectedProjects = new Set(args.protectedProjects ?? []);
    const batchSize = args.batchSize ?? 500;

    const oldChunks = await ctx.db
      .query("chunks")
      .withIndex("by_created")
      .order("asc")
      .collect();

    let deleted = 0;
    let skippedSignal = 0;
    let skippedProtected = 0;

    for (const chunk of oldChunks) {
      if (deleted >= batchSize) break;
      if (chunk.createdAt >= cutoff) break;

      if (chunk.isSignal) {
        skippedSignal++;
        continue;
      }
      if (chunk.project && protectedProjects.has(chunk.project)) {
        skippedProtected++;
        continue;
      }

      await ctx.db.delete(chunk._id);
      deleted++;
    }

    return {
      deleted,
      skippedSignal,
      skippedProtected,
      cutoffDate: new Date(cutoff).toISOString(),
    };
  },
});

// Rebuild stats by counting chunks per project (each project fits in 16MB)
export const refreshStats = mutation({
  args: {
    project: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    const ninetyDaysAgo = now - 90 * 24 * 60 * 60 * 1000;

    const chunks = await ctx.db.query("chunks")
      .withIndex("by_project", (q) => q.eq("project", args.project))
      .collect();

    let signal = 0, nonSignal = 0, olderThan30d = 0, olderThan90d = 0, prunableNow = 0;
    for (const c of chunks) {
      if (c.isSignal) signal++; else nonSignal++;
      if (c.createdAt < thirtyDaysAgo) olderThan30d++;
      if (c.createdAt < ninetyDaysAgo) olderThan90d++;
      if (!c.isSignal && c.createdAt < ninetyDaysAgo) prunableNow++;
    }

    return {
      project: args.project,
      total: chunks.length,
      signal, nonSignal, olderThan30d, olderThan90d, prunableNow,
    };
  },
});

export const saveStats = mutation({
  args: {
    chunks: v.object({
      total: v.number(),
      signal: v.number(),
      nonSignal: v.number(),
      olderThan30d: v.number(),
      olderThan90d: v.number(),
      prunableNow: v.number(),
    }),
    projects: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("stats").first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        chunks: args.chunks,
        projects: args.projects,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("stats", {
        chunks: args.chunks,
        projects: args.projects,
        updatedAt: Date.now(),
      });
    }
  },
});

export const getStorageStats = query({
  args: {},
  handler: async (ctx) => {
    // First get project list from memories (small table)
    const allMemories = await ctx.db.query("memories").collect();
    const knownProjects = new Set<string>();
    for (const m of allMemories) {
      if (m.project) knownProjects.add(m.project);
    }

    // Get the stored stats doc if it exists
    const statsDoc = await ctx.db.query("stats").first();
    if (statsDoc) {
      // Merge projects from stats with memory projects
      const allProjects = new Set([...statsDoc.projects, ...knownProjects]);
      return {
        chunks: statsDoc.chunks,
        projects: [...allProjects].sort(),
      };
    }

    // Fallback: no stats doc yet
    return {
      chunks: { total: 0, signal: 0, nonSignal: 0, olderThan30d: 0, olderThan90d: 0, prunableNow: 0 },
      projects: [...knownProjects].sort(),
    };
  },
});

export const getOtherStats = query({
  args: {},
  handler: async (ctx) => {
    const allMemories = await ctx.db.query("memories").collect();
    const graphEdges = await ctx.db.query("graph").collect();

    const projects = new Set<string>();
    for (const m of allMemories) {
      if (m.project) projects.add(m.project);
    }

    const byType = Object.fromEntries(
      [...new Set(allMemories.map((m) => m.type))].map((t) => [
        t, allMemories.filter((m) => m.type === t).length,
      ])
    );

    return {
      memories: { total: allMemories.length, byType },
      graph: { total: graphEdges.length },
      projects: [...projects].sort(),
    };
  },
});

export const getCombinedStats = action({
  args: {},
  handler: async (ctx): Promise<{
    chunks: { total: number; signal: number; nonSignal: number; olderThan30d: number; olderThan90d: number; prunableNow: number };
    memories: { total: number; byType: Record<string, number> };
    graph: { total: number };
    projects: string[];
  }> => {
    const chunkStats = await ctx.runQuery(api.prune.getStorageStats, {}) as any;
    const otherStats = await ctx.runQuery(api.prune.getOtherStats, {}) as any;
    const allProjects = new Set([...chunkStats.projects, ...otherStats.projects]);
    return {
      chunks: chunkStats.chunks,
      memories: otherStats.memories,
      graph: otherStats.graph,
      projects: [...allProjects].sort(),
    };
  },
});
