import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  chunks: defineTable({
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
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 384,
      filterFields: ["chunkType", "project"],
    })
    .index("by_session", ["sessionId", "sequence"])
    .index("by_project", ["project", "createdAt"])
    .index("by_type", ["chunkType", "createdAt"])
    .index("by_created", ["createdAt"]),

  memories: defineTable({
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
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 384,
      filterFields: ["type", "project"],
    })
    .index("by_type", ["type", "subtype", "createdAt"])
    .index("by_project", ["project", "createdAt"])
    .index("by_created", ["createdAt"]),

  graph: defineTable({
    subject: v.string(),
    predicate: v.string(),
    object: v.string(),
    confidence: v.number(),
    sourceMemoryId: v.optional(v.id("memories")),
    validFrom: v.number(),
    validUntil: v.optional(v.number()),
  })
    .index("by_subject", ["subject", "predicate"])
    .index("by_object", ["object", "predicate"])
    .index("by_predicate", ["predicate"]),
});
