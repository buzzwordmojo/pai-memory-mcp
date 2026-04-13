import { mutation } from "./_generated/server";

const PROJECT_RENAMES: Record<string, string> = {
  "matchbook": "matchbook",
  "claudopilot": "claudopilot",
  "mcp": "pai-memory-mcp",
  "reelms": "reelms",
  "cutlist": "cutlist",
  "platform": "career-track",
  "routing": "scrapcycle-routing",
  "io": "hermen",
  "server": "claudopilot-mcp-server",
  "org": "www-scrapcycle-org",
  "Dev": "lega-dev",
  "a036fc79": "career-track",
  "a1baf0f5": "career-track",
  "a6e5f6ce": "career-track",
  "projects": "buzzwordmojo",
};

export const fixProjectNames = mutation({
  handler: async (ctx) => {
    let updated = 0;

    const allChunks = await ctx.db.query("chunks").collect();
    for (const chunk of allChunks) {
      const newName = chunk.project ? PROJECT_RENAMES[chunk.project] : undefined;
      if (newName && newName !== chunk.project) {
        await ctx.db.patch(chunk._id, { project: newName });
        updated++;
      }
    }

    const allMemories = await ctx.db.query("memories").collect();
    for (const memory of allMemories) {
      const newName = memory.project ? PROJECT_RENAMES[memory.project] : undefined;
      if (newName && newName !== memory.project) {
        await ctx.db.patch(memory._id, { project: newName });
        updated++;
      }
    }

    return { updated };
  },
});
