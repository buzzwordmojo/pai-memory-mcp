import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const insert = mutation({
  args: {
    type: v.string(),
    subtype: v.optional(v.string()),
    title: v.string(),
    content: v.string(),
    embedding: v.optional(v.array(v.float64())),
    sourceChunkId: v.optional(v.id("chunks")),
    sourceSessionId: v.optional(v.string()),
    project: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    supersedes: v.optional(v.id("memories")),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("memories", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const getById = query({
  args: { id: v.id("memories") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const list = query({
  args: {
    type: v.optional(v.string()),
    subtype: v.optional(v.string()),
    project: v.optional(v.string()),
    since: v.optional(v.number()),
    until: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    let results;
    if (args.type && args.subtype && args.project) {
      const byType = await ctx.db
        .query("memories")
        .withIndex("by_type", (q) =>
          q.eq("type", args.type!).eq("subtype", args.subtype!)
        )
        .order("desc")
        .collect();
      results = byType.filter((m) => m.project === args.project);
    } else if (args.type && args.subtype) {
      results = await ctx.db
        .query("memories")
        .withIndex("by_type", (q) =>
          q.eq("type", args.type!).eq("subtype", args.subtype!)
        )
        .order("desc")
        .collect();
    } else if (args.type && args.project) {
      const byType = await ctx.db
        .query("memories")
        .withIndex("by_type", (q) => q.eq("type", args.type!))
        .order("desc")
        .collect();
      results = byType.filter((m) => m.project === args.project);
    } else if (args.type) {
      results = await ctx.db
        .query("memories")
        .withIndex("by_type", (q) => q.eq("type", args.type!))
        .order("desc")
        .collect();
    } else if (args.project) {
      results = await ctx.db
        .query("memories")
        .withIndex("by_project", (q) => q.eq("project", args.project!))
        .order("desc")
        .collect();
    } else {
      results = await ctx.db
        .query("memories")
        .withIndex("by_created")
        .order("desc")
        .collect();
    }

    // Apply date filters
    if (args.since) {
      results = results.filter((m) => m.createdAt >= args.since!);
    }
    if (args.until) {
      results = results.filter((m) => m.createdAt <= args.until!);
    }

    // Exclude expired and superseded
    results = results.filter((m) => {
      if (m.expiresAt && m.expiresAt < Date.now()) return false;
      return true;
    });

    return results.slice(0, limit);
  },
});
