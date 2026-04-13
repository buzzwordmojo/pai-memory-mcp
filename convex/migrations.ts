import { v } from "convex/values";
import { mutation } from "./_generated/server";

export const renameProject = mutation({
  args: {
    from: v.string(),
    to: v.string(),
  },
  handler: async (ctx, args) => {
    let updated = 0;

    const chunks = await ctx.db.query("chunks")
      .withIndex("by_project", (q) => q.eq("project", args.from))
      .collect();
    for (const chunk of chunks) {
      await ctx.db.patch(chunk._id, { project: args.to });
      updated++;
    }

    const memories = await ctx.db.query("memories")
      .withIndex("by_project", (q) => q.eq("project", args.from))
      .collect();
    for (const memory of memories) {
      await ctx.db.patch(memory._id, { project: args.to });
      updated++;
    }

    return { updated, from: args.from, to: args.to };
  },
});
