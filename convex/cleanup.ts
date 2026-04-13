import { mutation } from "./_generated/server";

export const deleteTestData = mutation({
  handler: async (ctx) => {
    let deletedMemories = 0;
    let deletedChunks = 0;

    // Delete test memories — those with test-related titles or tags
    const allMemories = await ctx.db.query("memories").collect();
    for (const m of allMemories) {
      const isTest =
        m.tags?.includes("test") ||
        m.tags?.includes("automated") ||
        m.title.includes("Automated Test") ||
        m.title.includes("Dedup Test") ||
        m.title.includes("Dedup Original") ||
        m.title.includes("Dedup Duplicate") ||
        m.title.includes("Supersede") ||
        m.title.includes("Debug Test") ||
        m.title.includes("Integration Test");
      if (isTest) {
        await ctx.db.delete(m._id);
        deletedMemories++;
      }
    }

    // Delete test chunks — those with test session IDs
    const allChunks = await ctx.db.query("chunks").collect();
    for (const c of allChunks) {
      if (c.sessionId.startsWith("test-session-")) {
        await ctx.db.delete(c._id);
        deletedChunks++;
      }
    }

    return { deletedMemories, deletedChunks };
  },
});
