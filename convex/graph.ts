import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

interface TemporalRecord {
  validFrom: number;
  validUntil?: number;
}

function filterByValidity<T extends TemporalRecord>(
  records: T[],
  asOf?: number
): T[] {
  const t = asOf ?? Date.now();
  return records.filter((r) => r.validFrom <= t && (!r.validUntil || r.validUntil > t));
}

export const insert = mutation({
  args: {
    subject: v.string(),
    predicate: v.string(),
    object: v.string(),
    confidence: v.number(),
    sourceMemoryId: v.optional(v.id("memories")),
    validFrom: v.number(),
    validUntil: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("graph", args);
  },
});

export const queryBySubject = query({
  args: {
    subject: v.string(),
    predicate: v.optional(v.string()),
    asOf: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let results;
    if (args.predicate) {
      results = await ctx.db
        .query("graph")
        .withIndex("by_subject", (q) =>
          q.eq("subject", args.subject).eq("predicate", args.predicate!)
        )
        .collect();
    } else {
      results = await ctx.db
        .query("graph")
        .withIndex("by_subject", (q) => q.eq("subject", args.subject))
        .collect();
    }

    return filterByValidity(results, args.asOf);
  },
});

export const queryByObject = query({
  args: {
    object: v.string(),
    predicate: v.optional(v.string()),
    asOf: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let results;
    if (args.predicate) {
      results = await ctx.db
        .query("graph")
        .withIndex("by_object", (q) =>
          q.eq("object", args.object).eq("predicate", args.predicate!)
        )
        .collect();
    } else {
      results = await ctx.db
        .query("graph")
        .withIndex("by_object", (q) => q.eq("object", args.object))
        .collect();
    }

    return filterByValidity(results, args.asOf);
  },
});

export const traverse = query({
  args: {
    entity: v.string(),
    direction: v.optional(v.string()),
    hops: v.optional(v.number()),
    asOf: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const maxHops = Math.min(args.hops ?? 1, 3);
    const direction = args.direction ?? "both";
    const asOf = args.asOf ?? Date.now();
    const visited = new Set<string>();
    const edges: Array<{
      subject: string;
      predicate: string;
      object: string;
      confidence: number;
      hop: number;
    }> = [];

    const queue: Array<{ entity: string; hop: number }> = [
      { entity: args.entity, hop: 0 },
    ];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.hop >= maxHops || visited.has(current.entity)) continue;
      visited.add(current.entity);

      if (direction === "outgoing" || direction === "both") {
        const outgoing = await ctx.db
          .query("graph")
          .withIndex("by_subject", (q) => q.eq("subject", current.entity))
          .collect();
        for (const edge of filterByValidity(outgoing, asOf)) {
          edges.push({
            subject: edge.subject,
            predicate: edge.predicate,
            object: edge.object,
            confidence: edge.confidence,
            hop: current.hop + 1,
          });
          if (!visited.has(edge.object)) {
            queue.push({ entity: edge.object, hop: current.hop + 1 });
          }
        }
      }

      if (direction === "incoming" || direction === "both") {
        const incoming = await ctx.db
          .query("graph")
          .withIndex("by_object", (q) => q.eq("object", current.entity))
          .collect();
        for (const edge of filterByValidity(incoming, asOf)) {
          edges.push({
            subject: edge.subject,
            predicate: edge.predicate,
            object: edge.object,
            confidence: edge.confidence,
            hop: current.hop + 1,
          });
          if (!visited.has(edge.subject)) {
            queue.push({ entity: edge.subject, hop: current.hop + 1 });
          }
        }
      }
    }

    return edges;
  },
});
