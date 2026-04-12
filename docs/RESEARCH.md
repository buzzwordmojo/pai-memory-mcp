# PAI Memory MCP — Research & Prior Art

**Date:** 2026-04-12

---

## MemPalace Evaluation

[MemPalace](https://github.com/milla-jovovich/mempalace) is an open-source MCP memory system created by Milla Jovovich and Ben Sigman. It uses a "method of loci" spatial metaphor for organizing AI memories.

### Architecture

- **Wings** → top-level containers (people, projects)
- **Rooms** → topics within wings
- **Halls** → memory categories (facts, events, discoveries, preferences, advice)
- **Closets** → 30x compressed summaries (AAAK format)
- **Drawers** → original verbatim content

Storage: ChromaDB (vectors) + SQLite (metadata), running locally.

### MCP Tools (24 total)

**Read:** `mempalace_status`, `mempalace_list_wings`, `mempalace_list_rooms`, `mempalace_get_taxonomy`, `mempalace_get_aaak_spec`, `mempalace_search`, `mempalace_check_duplicate`, `mempalace_traverse`, `mempalace_find_tunnels`, `mempalace_graph_stats`

**Write:** `mempalace_add_drawer`, `mempalace_delete_drawer`

**Knowledge Graph:** `mempalace_kg_query`, `mempalace_kg_add`, `mempalace_kg_invalidate`, `mempalace_kg_timeline`, `mempalace_kg_stats`

**Agent Diary:** `mempalace_diary_write`, `mempalace_diary_read`

### What We Stole

1. **"Store everything verbatim" philosophy** — the fundamental insight. Don't rely on hooks to decide what's important. Store it all and let search sort it out.
2. **Knowledge graph with temporal validity** — entity relationships that can expire (`valid_from`, `valid_until`)
3. **Diary/journal concept** — agent observations as a memory type

### What We Rejected

1. **AAAK Compression** — marketed as "lossless" but independent analysis shows 12.4% accuracy drop (96.6% → 84.2%). Not worth it when storage is cheap and embeddings are fixed-size.
2. **Spatial metaphor (Wings/Rooms/Halls)** — adds conceptual overhead without improving retrieval. Simple type + project filtering achieves the same thing.
3. **Auto-save hooks (every 15 messages)** — would conflict with PAI's existing hook system.
4. **ChromaDB dependency** — requires a separate running process. Convex's native vector search eliminates this.

### Independent Analysis Findings

Source: [lhl/agentic-memory ANALYSIS-mempalace.md](https://github.com/lhl/agentic-memory/blob/main/ANALYSIS-mempalace.md)

**Claims vs. Reality:**

| Claim | Reality |
|-------|---------|
| "96.6% LongMemEval R@5" | Measures ChromaDB's default embeddings on raw text, not MemPalace's spatial architecture |
| "Zero information loss" compression | AAAK drops accuracy from 96.6% to 84.2% — definitionally lossy |
| "Automatic inconsistency flagging" | Code contains no such functionality; only identical triple dedup exists |
| "~30x compression" | Uses `len(text)//3` heuristic for token counting, not real tokenization |

**Genuine Strengths:**
- ~170 token startup cost (very low context overhead)
- Zero-LLM write pipeline (fully offline extraction)
- Verbatim-first: original content preserved separately from compressed

**Architecture Weaknesses:**
- Single ChromaDB collection, no semantic distinction
- Knowledge graph lacks multi-hop traversal
- Entity resolution uses naive slug matching

### Pricing Comparison

| System | Cost |
|--------|------|
| MemPalace | $0 (local only, MIT license) |
| Mem0 | $19-249/mo |
| Zep | $25/mo+ |
| PAI Memory MCP (Convex) | $0-2/mo |

---

## Key Design Insight

The comparison between PAI's current memory and MemPalace's approach revealed a critical gap:

```
PAI today:    100% of transcripts → 1% extracted → 99% lost after 30 days
MemPalace:    100% stored → 84.2% retrievable (with AAAK) or 96.6% (raw)
Optimal:      100% stored → 96.6% retrievable (raw text + vector search, no compression)
```

The real insight isn't about compression or spatial metaphors — it's that **selective extraction is a bigger information loss than any compression scheme.** Store everything, search semantically.

---

## Other Systems Evaluated

### Cloudflare Vectorize
- Separate vector database service
- Free tier: 5M stored dimensions (only ~6,500 vectors at 768-dim)
- Pricing: $0.05/100M stored dims, $0.01/M queried dims
- Verdict: Free tier too tight for our volume

### sqlite-vec
- Pure C SQLite extension for vector search
- Zero dependencies, runs anywhere
- Handles tens of thousands of embeddings on minimal hardware
- KNN search with SIMD acceleration
- Verdict: Excellent for self-hosted VPS option

### pgvector (PostgreSQL)
- Vector search extension for Postgres
- Production-ready in 2026
- Available on Neon, Supabase, RDS
- Verdict: Overkill — requires running Postgres for a simple use case

### AWS Bedrock Titan Embed v2
- $0.02 per 1M tokens for embeddings
- 384 or 1024 dimensions
- Verdict: Good embedding option if not pre-embedding locally

---

## Sources

- [MemPalace GitHub](https://github.com/milla-jovovich/mempalace)
- [MemPalace MCP Server Code](https://github.com/milla-jovovich/mempalace/blob/main/mempalace/mcp_server.py)
- [Independent Analysis (lhl/agentic-memory)](https://github.com/lhl/agentic-memory/blob/main/ANALYSIS-mempalace.md)
- [MemPalace Setup Guide](https://www.mempalace.tech/guides/setup)
- [MemPalace Review (danilchenko.dev)](https://www.danilchenko.dev/posts/2026-04-10-mempalace-review-ai-memory-system-milla-jovovich/)
- [Convex Vector Search Docs](https://docs.convex.dev/search/vector-search)
- [Convex Pricing](https://www.convex.dev/pricing)
- [Cloudflare Vectorize Pricing](https://developers.cloudflare.com/vectorize/platform/pricing/)
- [Cloudflare Remote MCP Guide](https://developers.cloudflare.com/agents/guides/remote-mcp-server/)
- [sqlite-vec GitHub](https://github.com/asg017/sqlite-vec)
