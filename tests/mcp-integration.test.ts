import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

const URL = "https://ardent-nightingale-678.convex.site/mcp";
const TOKEN = "oEKEz4keUbUvVnRkuJKApjWaXspcu1WaQheTPItJzFg=";

async function mcpCall(method: string, params?: Record<string, unknown>) {
  const body: Record<string, unknown> = {
    jsonrpc: "2.0",
    id: Math.floor(Math.random() * 100000),
    method,
  };
  if (params) body.params = params;

  const res = await fetch(URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<any>;
}

async function toolCall(name: string, args: Record<string, unknown> = {}) {
  const res = await mcpCall("tools/call", { name, arguments: args });
  if (res.error) throw new Error(res.error.message);
  const text = res.result.content[0].text;
  return JSON.parse(text);
}

describe("MCP Server", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await fetch(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    });
    assert.equal(res.status, 401);
  });

  it("handles initialize", async () => {
    const res = await mcpCall("initialize");
    assert.equal(res.result.serverInfo.name, "pai-memory");
    assert.equal(res.result.protocolVersion, "2024-11-05");
    assert.ok(res.result.capabilities.tools);
  });

  it("lists all 9 tools", async () => {
    const res = await mcpCall("tools/list");
    const names = res.result.tools.map((t: any) => t.name).sort();
    assert.deepEqual(names, [
      "memory_add",
      "memory_config",
      "memory_get",
      "memory_graph",
      "memory_ingest",
      "memory_list",
      "memory_prune",
      "memory_search",
      "memory_stats",
    ]);
  });

  it("returns error for unknown method", async () => {
    const res = await mcpCall("nonexistent/method");
    assert.ok(res.error);
    assert.equal(res.error.code, -32601);
  });

  it("returns error for unknown tool", async () => {
    const res = await mcpCall("tools/call", {
      name: "nonexistent_tool",
      arguments: {},
    });
    assert.ok(res.error);
  });

  it("handles ping", async () => {
    const res = await mcpCall("ping");
    assert.ok(res.result);
  });
});

describe("memory_add + memory_get round-trip", () => {
  let createdId: string;

  it("creates a memory", async () => {
    const result = await toolCall("memory_add", {
      content: "Test memory for automated testing - should be cleaned up",
      type: "reference",
      title: "Automated Test Memory",
      tags: ["test", "automated"],
      project: "pai-memory-mcp",
    });
    assert.ok(result.id);
    assert.equal(result.status, "created");
    createdId = result.id;
  });

  it("retrieves the memory by ID", async () => {
    const result = await toolCall("memory_get", {
      id: createdId,
      table: "memories",
    });
    assert.equal(result.title, "Automated Test Memory");
    assert.equal(result.type, "reference");
    assert.equal(result.content, "Test memory for automated testing - should be cleaned up");
    assert.deepEqual(result.tags, ["test", "automated"]);
    assert.equal(result.project, "pai-memory-mcp");
  });

  it("appears in memory_list filtered by type", async () => {
    const result = await toolCall("memory_list", {
      type: "reference",
      project: "pai-memory-mcp",
    });
    assert.ok(Array.isArray(result));
    const found = result.find((m: any) => m.title === "Automated Test Memory");
    assert.ok(found, "Created memory should appear in list");
  });
});

describe("memory_add deduplication", () => {
  it("deduplicates when exact same embedding is submitted twice", async () => {
    // Use a synthetic embedding to avoid model-similarity collisions
    const uniqueEmbedding = Array.from({ length: 384 }, (_, i) =>
      Math.sin(Date.now() + i * 7.3)
    );

    const first = await toolCall("memory_add", {
      content: `Dedup original ${Date.now()}`,
      type: "work",
      title: `Dedup Original ${Date.now()}`,
      embedding: uniqueEmbedding,
    });
    assert.equal(first.status, "created");

    // Wait for vector index propagation (Convex vector indexes are eventually consistent)
    await new Promise((r) => setTimeout(r, 3000));

    // Same embedding — should deduplicate against the one we just created
    const second = await toolCall("memory_add", {
      content: `Dedup duplicate ${Date.now()}`,
      type: "work",
      title: `Dedup Duplicate ${Date.now()}`,
      embedding: uniqueEmbedding,
    });
    assert.equal(second.status, "deduplicated");
    // Should return the ID of the matched memory
    assert.ok(second.id, "Should return matched memory ID");
    assert.ok(second.score >= 0.95);
  });

  it("allows insert when supersedes is set even if duplicate", async () => {
    // Use random embedding to avoid matching previous test runs
    const uniqueEmbedding = Array.from({ length: 384 }, () => Math.random() * 2 - 1);

    const original = await toolCall("memory_add", {
      content: `Supersede original ${Date.now()}`,
      type: "work",
      title: `Supersede Original ${Date.now()}`,
      embedding: uniqueEmbedding,
    });
    // May be "created" or "deduplicated" depending on accumulated test data
    // What matters is the supersedes path below
    const originalId = original.id;

    await new Promise((r) => setTimeout(r, 3000));

    // Same embedding but with supersedes — should always create, bypassing dedup
    const updated = await toolCall("memory_add", {
      content: `Supersede updated ${Date.now()}`,
      type: "work",
      title: `Supersede Updated ${Date.now()}`,
      embedding: uniqueEmbedding,
      supersedes: originalId,
    });
    assert.equal(updated.status, "created");
    assert.ok(updated.id, "Should return new memory ID");
  });
});

describe("memory_ingest deduplication", () => {
  const testSessionId = `test-session-${Date.now()}`;

  it("ingests a session", async () => {
    const result = await toolCall("memory_ingest", {
      sessionId: testSessionId,
      project: "pai-memory-mcp",
      chunks: [
        {
          role: "user",
          content: "Test chunk 1",
          chunkType: "conversation",
          isSignal: true,
          sequence: 0,
          createdAt: Date.now(),
        },
        {
          role: "assistant",
          content: "Test chunk 2",
          chunkType: "conversation",
          isSignal: false,
          sequence: 1,
          createdAt: Date.now(),
        },
      ],
    });
    assert.equal(result.status, "ingested");
    assert.equal(result.chunksInserted, 2);
  });

  it("skips already-ingested session", async () => {
    const result = await toolCall("memory_ingest", {
      sessionId: testSessionId,
      project: "pai-memory-mcp",
      chunks: [
        {
          role: "user",
          content: "Should not be inserted",
          chunkType: "conversation",
          isSignal: true,
          sequence: 0,
          createdAt: Date.now(),
        },
      ],
    });
    assert.equal(result.status, "skipped");
    assert.ok(result.reason.includes("already ingested"));
  });
});

describe("memory_stats", () => {
  it("returns storage statistics", async () => {
    const result = await toolCall("memory_stats");
    assert.ok(typeof result.chunks.total === "number");
    assert.ok(typeof result.chunks.signal === "number");
    assert.ok(typeof result.chunks.nonSignal === "number");
    assert.ok(typeof result.memories.total === "number");
    assert.ok(result.memories.byType);
    assert.ok(typeof result.graph.total === "number");
    assert.ok(Array.isArray(result.projects));
  });
});

describe("memory_prune dry run", () => {
  it("previews prunable chunks without deleting", async () => {
    const result = await toolCall("memory_prune", {
      maxAgeDays: 90,
      protectedProjects: ["pai-memory-mcp"],
      dryRun: true,
    });
    assert.equal(result.dryRun, true);
    assert.ok(typeof result.prunableCount === "number");
    assert.equal(result.maxAgeDays, 90);
    assert.deepEqual(result.protectedProjects, ["pai-memory-mcp"]);
  });
});

describe("memory_graph", () => {
  it("returns empty edges for unknown entity", async () => {
    const result = await toolCall("memory_graph", {
      entity: "nonexistent-entity-12345",
    });
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 0);
  });
});

describe("batch requests", () => {
  it("handles multiple JSON-RPC requests in one call", async () => {
    const res = await fetch(URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify([
        { jsonrpc: "2.0", id: 1, method: "ping" },
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
      ]),
    });
    const data = await res.json() as any[];
    assert.equal(data.length, 2);
    assert.equal(data[0].id, 1);
    assert.equal(data[1].id, 2);
    assert.ok(data[1].result.tools);
  });
});
