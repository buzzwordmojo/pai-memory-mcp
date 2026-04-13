import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const insert = mutation({
  args: {
    sessionId: v.string(),
    project: v.optional(v.string()),
    sequence: v.number(),
    role: v.string(),
    content: v.string(),
    chunkType: v.string(),
    isSignal: v.boolean(),
    tokensApprox: v.optional(v.number()),
    embedding: v.optional(v.array(v.float64())),
    metadata: v.optional(v.string()),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("chunks", args);
  },
});

export const insertBatch = mutation({
  args: {
    chunks: v.array(
      v.object({
        sessionId: v.string(),
        project: v.optional(v.string()),
        sequence: v.number(),
        role: v.string(),
        content: v.string(),
        chunkType: v.string(),
        isSignal: v.boolean(),
        tokensApprox: v.optional(v.number()),
        embedding: v.optional(v.array(v.float64())),
        metadata: v.optional(v.string()),
        createdAt: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const ids = [];
    const projects = new Set<string>();
    let signalCount = 0;

    for (const chunk of args.chunks) {
      ids.push(await ctx.db.insert("chunks", chunk));
      if (chunk.isSignal) signalCount++;
      if (chunk.project) projects.add(chunk.project);
    }

    // Update stats counter
    const existing = await ctx.db.query("stats").first();
    if (existing) {
      const allProjects = new Set([...existing.projects, ...projects]);
      await ctx.db.patch(existing._id, {
        chunks: {
          ...existing.chunks,
          total: existing.chunks.total + args.chunks.length,
          signal: existing.chunks.signal + signalCount,
          nonSignal: existing.chunks.nonSignal + (args.chunks.length - signalCount),
        },
        projects: [...allProjects],
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("stats", {
        chunks: {
          total: args.chunks.length,
          signal: signalCount,
          nonSignal: args.chunks.length - signalCount,
          olderThan30d: 0,
          olderThan90d: 0,
          prunableNow: 0,
        },
        projects: [...projects],
        updatedAt: Date.now(),
      });
    }

    return ids;
  },
});

export const getById = query({
  args: { id: v.id("chunks") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const getBySession = query({
  args: {
    sessionId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const q = ctx.db
      .query("chunks")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("asc");
    return args.limit ? await q.take(args.limit) : await q.collect();
  },
});

export const sessionExists = query({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("chunks")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .first();
    return existing !== null;
  },
});

export const getSurrounding = query({
  args: {
    sessionId: v.string(),
    sequence: v.number(),
    windowSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const window = args.windowSize ?? 3;
    const all = await ctx.db
      .query("chunks")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    const targetIdx = all.findIndex((c) => c.sequence === args.sequence);
    if (targetIdx === -1) return { before: [], after: [] };

    const start = Math.max(0, targetIdx - window);
    const end = Math.min(all.length, targetIdx + window + 1);

    return {
      before: all.slice(start, targetIdx).map((c) => c.content),
      after: all.slice(targetIdx + 1, end).map((c) => c.content),
    };
  },
});
