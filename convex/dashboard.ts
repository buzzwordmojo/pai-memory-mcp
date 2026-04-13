import { v } from "convex/values";
import { query } from "./_generated/server";

export const getData = query({
  args: {
    type: v.optional(v.string()),
    project: v.optional(v.string()),
    table: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;
    const table = args.table ?? "memories";

    if (table === "memories") {
      let results;
      if (args.type && args.project) {
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

      return {
        table: "memories",
        items: results.slice(0, limit).map((m) => ({
          id: m._id,
          type: m.type,
          subtype: m.subtype,
          title: m.title,
          content: m.content,
          project: m.project,
          tags: m.tags,
          createdAt: m.createdAt,
          updatedAt: m.updatedAt,
        })),
      };
    }

    if (table === "chunks") {
      let results;
      if (args.type && args.project) {
        // Filter by chunkType index, then project in memory
        const byType = await ctx.db
          .query("chunks")
          .withIndex("by_type", (q) => q.eq("chunkType", args.type!))
          .order("desc")
          .collect();
        results = byType.filter((c) => c.project === args.project);
      } else if (args.type) {
        results = await ctx.db
          .query("chunks")
          .withIndex("by_type", (q) => q.eq("chunkType", args.type!))
          .order("desc")
          .collect();
      } else if (args.project) {
        results = await ctx.db
          .query("chunks")
          .withIndex("by_project", (q) => q.eq("project", args.project!))
          .order("desc")
          .collect();
      } else {
        results = await ctx.db
          .query("chunks")
          .withIndex("by_created")
          .order("desc")
          .collect();
      }

      return {
        table: "chunks",
        items: results.slice(0, limit).map((c) => ({
          id: c._id,
          sessionId: c.sessionId,
          role: c.role,
          chunkType: c.chunkType,
          isSignal: c.isSignal,
          content: c.content,
          project: c.project,
          createdAt: c.createdAt,
        })),
      };
    }

    if (table === "graph") {
      const results = await ctx.db.query("graph").collect();
      const now = Date.now();
      return {
        table: "graph",
        items: results
          .filter((r) => r.validFrom <= now && (!r.validUntil || r.validUntil > now))
          .slice(0, limit)
          .map((g) => ({
            id: g._id,
            subject: g.subject,
            predicate: g.predicate,
            object: g.object,
            confidence: g.confidence,
            validFrom: g.validFrom,
            validUntil: g.validUntil,
          })),
      };
    }

    return { table, items: [] };
  },
});
