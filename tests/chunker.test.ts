import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chunkSession, type RawMessage } from "../src/chunker";

const NOW = Date.now();

describe("chunkSession", () => {
  it("combines short user+assistant pairs into single conversation chunk", () => {
    const messages: RawMessage[] = [
      { type: "human", content: "What is Convex?" },
      { type: "assistant", content: "Convex is a backend platform." },
    ];
    const chunks = chunkSession(messages, NOW);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].chunkType, "conversation");
    assert.equal(chunks[0].isSignal, true);
    assert.ok(chunks[0].content.includes("What is Convex?"));
    assert.ok(chunks[0].content.includes("Convex is a backend platform."));
  });

  it("keeps long user+assistant as separate chunks", () => {
    const longText = "x".repeat(2000);
    const messages: RawMessage[] = [
      { type: "human", content: longText },
      { type: "assistant", content: longText },
    ];
    const chunks = chunkSession(messages, NOW);
    assert.ok(chunks.length >= 2, `Expected >=2 chunks, got ${chunks.length}`);
  });

  it("collapses consecutive system messages and marks non-signal", () => {
    const messages: RawMessage[] = [
      { type: "system", content: "System prompt part 1" },
      { type: "system", content: "System prompt part 2" },
      { type: "human", content: "Hello" },
    ];
    const chunks = chunkSession(messages, NOW);
    const systemChunks = chunks.filter((c) => c.chunkType === "system");
    assert.equal(systemChunks.length, 1);
    assert.equal(systemChunks[0].isSignal, false);
    assert.ok(systemChunks[0].content.includes("part 1"));
    assert.ok(systemChunks[0].content.includes("part 2"));
  });

  it("marks tool results as non-signal when long", () => {
    const messages: RawMessage[] = [
      { type: "tool_result", content: "x".repeat(1000) },
    ];
    const chunks = chunkSession(messages, NOW);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].chunkType, "tool_result");
    assert.equal(chunks[0].isSignal, false);
  });

  it("marks tool result errors as signal regardless of length", () => {
    const messages: RawMessage[] = [
      { type: "tool_result", content: "x".repeat(1000), is_error: true },
    ];
    const chunks = chunkSession(messages, NOW);
    assert.equal(chunks[0].isSignal, true);
  });

  it("marks short tool results as signal", () => {
    const messages: RawMessage[] = [
      { type: "tool_result", content: "File not found" },
    ];
    const chunks = chunkSession(messages, NOW);
    assert.equal(chunks[0].isSignal, true);
  });

  it("assigns sequential sequence numbers", () => {
    const messages: RawMessage[] = [
      { type: "human", content: "First" },
      { type: "assistant", content: "Second" },
      { type: "human", content: "Third" },
    ];
    const chunks = chunkSession(messages, NOW);
    for (let i = 0; i < chunks.length; i++) {
      assert.equal(chunks[i].sequence, i);
    }
  });

  it("skips empty messages", () => {
    const messages: RawMessage[] = [
      { type: "human", content: "" },
      { type: "human" },
      { type: "human", content: "Real message" },
    ];
    const chunks = chunkSession(messages, NOW);
    assert.equal(chunks.length, 1);
    assert.ok(chunks[0].content.includes("Real message"));
  });

  it("splits very long messages at paragraph boundaries", () => {
    const paragraphs = Array.from({ length: 20 }, (_, i) =>
      `Paragraph ${i}: ${"word ".repeat(100)}`
    ).join("\n\n");
    const messages: RawMessage[] = [
      { type: "human", content: paragraphs },
    ];
    const chunks = chunkSession(messages, NOW);
    assert.ok(chunks.length > 1, `Expected >1 chunks for long text, got ${chunks.length}`);
    for (const chunk of chunks) {
      assert.ok(chunk.content.length <= 2048 + 100, "Chunk exceeds max size");
    }
  });

  it("sets createdAt from session timestamp", () => {
    const timestamp = 1700000000000;
    const messages: RawMessage[] = [
      { type: "human", content: "Hello" },
    ];
    const chunks = chunkSession(messages, timestamp);
    assert.equal(chunks[0].createdAt, timestamp);
  });

  it("estimates token count", () => {
    const messages: RawMessage[] = [
      { type: "human", content: "Hello world" },
    ];
    const chunks = chunkSession(messages, NOW);
    assert.ok(chunks[0].tokensApprox > 0);
    assert.ok(chunks[0].tokensApprox < 100);
  });
});
