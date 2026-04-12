import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";

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

export const getStorageStats = query({
  args: {},
  handler: async (ctx) => {
    const allChunks = await ctx.db.query("chunks").collect();
    const allMemories = await ctx.db.query("memories").collect();
    const allGraph = await ctx.db.query("graph").collect();

    const signalChunks = allChunks.filter((c) => c.isSignal);
    const nonSignalChunks = allChunks.filter((c) => !c.isSignal);

    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    const ninetyDaysAgo = now - 90 * 24 * 60 * 60 * 1000;

    const projects = new Set<string>();
    for (const c of allChunks) {
      if (c.project) projects.add(c.project);
    }
    for (const m of allMemories) {
      if (m.project) projects.add(m.project);
    }

    return {
      chunks: {
        total: allChunks.length,
        signal: signalChunks.length,
        nonSignal: nonSignalChunks.length,
        olderThan30d: allChunks.filter((c) => c.createdAt < thirtyDaysAgo).length,
        olderThan90d: allChunks.filter((c) => c.createdAt < ninetyDaysAgo).length,
        prunableNow: nonSignalChunks.filter((c) => c.createdAt < ninetyDaysAgo).length,
      },
      memories: {
        total: allMemories.length,
        byType: Object.fromEntries(
          [...new Set(allMemories.map((m) => m.type))].map((t) => [
            t,
            allMemories.filter((m) => m.type === t).length,
          ])
        ),
      },
      graph: { total: allGraph.length },
      projects: [...projects].sort(),
    };
  },
});
