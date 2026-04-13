import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isProjectExcluded, redactContent, type PaiMemoryConfig } from "../src/config";

const config: PaiMemoryConfig = {
  includeProjects: [],
  excludeProjects: ["secret-client", "classified"],
  excludePatterns: [
    "sk-[a-zA-Z0-9_-]{20,}",
    "AKIA[A-Z0-9]{16}",
    "ghp_[a-zA-Z0-9]{36}",
  ],
  protectedProjects: ["important-project"],
  orgPrefixes: [],
  projectNameOverrides: {},
};

describe("isProjectExcluded", () => {
  it("returns true for excluded projects", () => {
    assert.equal(isProjectExcluded("secret-client", config), true);
    assert.equal(isProjectExcluded("classified", config), true);
  });

  it("returns false for non-excluded projects", () => {
    assert.equal(isProjectExcluded("my-project", config), false);
    assert.equal(isProjectExcluded("important-project", config), false);
  });

  it("returns false for undefined project", () => {
    assert.equal(isProjectExcluded(undefined, config), false);
  });

  it("excludes unlisted projects when includeProjects is set", () => {
    const includeConfig: PaiMemoryConfig = {
      ...config,
      includeProjects: ["scrapcycle", "scrapcycle-routing"],
    };
    assert.equal(isProjectExcluded("scrapcycle", includeConfig), false);
    assert.equal(isProjectExcluded("scrapcycle-routing", includeConfig), false);
    assert.equal(isProjectExcluded("matchbook", includeConfig), true);
    assert.equal(isProjectExcluded(undefined, includeConfig), true);
  });
});

describe("redactContent", () => {
  it("redacts OpenAI API keys", () => {
    const text = "Use this key: sk-abcdefghij1234567890abcd";
    const { content, redacted } = redactContent(text, config);
    assert.equal(redacted, true);
    assert.ok(!content.includes("sk-abcdefghij"));
    assert.ok(content.includes("[REDACTED]"));
  });

  it("redacts AWS access key IDs", () => {
    const text = "AWS key: AKIAIOSFODNN7EXAMPLE";
    const { content, redacted } = redactContent(text, config);
    assert.equal(redacted, true);
    assert.ok(!content.includes("AKIAIOSFODNN7EXAMPLE"));
  });

  it("redacts GitHub personal access tokens", () => {
    const text = "Token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const { content, redacted } = redactContent(text, config);
    assert.equal(redacted, true);
    assert.ok(!content.includes("ghp_"));
  });

  it("does not redact normal text", () => {
    const text = "This is a normal conversation about programming.";
    const { content, redacted } = redactContent(text, config);
    assert.equal(redacted, false);
    assert.equal(content, text);
  });

  it("redacts multiple secrets in one string", () => {
    const text = "Key1: sk-aaaaaaaaaaaaaaaaaaaaaa Key2: AKIAIOSFODNN7EXAMPLE";
    const { content, redacted } = redactContent(text, config);
    assert.equal(redacted, true);
    const redactedCount = (content.match(/\[REDACTED\]/g) || []).length;
    assert.equal(redactedCount, 2);
  });

  it("handles empty patterns gracefully", () => {
    const emptyConfig: PaiMemoryConfig = {
      includeProjects: [],
      excludeProjects: [],
      excludePatterns: [],
      protectedProjects: [],
      orgPrefixes: [],
      projectNameOverrides: {},
    };
    const text = "sk-abcdefghij1234567890abcd";
    const { content, redacted } = redactContent(text, emptyConfig);
    assert.equal(redacted, false);
    assert.equal(content, text);
  });
});
