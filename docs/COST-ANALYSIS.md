# PAI Memory MCP — Cost Analysis

**Date:** 2026-04-12
**Based on:** ~1,532 sessions/month, 164MB transcripts, ~122,560 chunks/month

---

## Usage Profile

| Metric | Monthly Value |
|--------|-------------|
| Sessions ingested | ~1,532 |
| Chunks generated | ~122,560 |
| Signal chunks (embedded, 20%) | ~24,512 |
| Avg chunk size | ~400 bytes |
| Embedding dimensions | 384 (bge-small-en-v1.5) |
| Vector size | 3,072 bytes per vector |
| DB storage added | ~70 MB/month |
| Search index added | ~180 MB/month (with 2.5x index overhead) |
| Function calls | ~149K/month |
| MCP search queries | ~50/day |

---

## Platform Comparison

### Monthly Cost Over Time

| Month | Convex Starter | Convex Pro (marginal) | AWS Lambda+S3 | Hetzner VPS | Cloudflare |
|-------|---------------|----------------------|---------------|-------------|------------|
| 1 | $0.00 | $0.00 | $1.40 | $3.50 | $5.00 |
| 3 | $0.01 | $0.00 | $1.41 | $3.50 | $5.01 |
| 6 | $0.30 | $0.02 | $1.41 | $3.50 | $5.02 |
| 12 | $0.95 | $0.55 | $1.42 | $3.50 | $5.05 |
| 18 | $1.62 | $1.07 | $1.43 | $3.50 | $5.08 |
| 24 | $2.28 | $1.60 | $1.44 | $3.50 | $5.11 |

### Cumulative Cost Over Time

| Month | Convex Starter | Convex Pro (marginal) | AWS Lambda+S3 | Hetzner VPS | Cloudflare |
|-------|---------------|----------------------|---------------|-------------|------------|
| 3 | $0.01 | $0.00 | $4.21 | $10.50 | $15.01 |
| 6 | $0.63 | $0.02 | $8.44 | $21.00 | $30.07 |
| 12 | $4.67 | $2.01 | $16.93 | $42.00 | $60.31 |
| 24 | $24.74 | $15.44 | $34.08 | $84.00 | $121.29 |

### Winner by Time Horizon

| Period | Cheapest | 2nd | 3rd | 4th | 5th |
|--------|----------|-----|-----|-----|-----|
| 3 months | Convex Starter ($0.01) | AWS ($4.21) | Hetzner ($10.50) | Cloudflare ($15) | Convex Pro ($75) |
| 12 months | Convex Starter ($4.67) | AWS ($16.93) | Hetzner ($42) | Cloudflare ($60) | Convex Pro ($302) |
| 24 months | Convex Starter ($24.74) | AWS ($34.08) | Hetzner ($84) | Cloudflare ($121) | Convex Pro ($615) |

**Note:** "Convex Pro (marginal)" assumes you're already paying $25/mo for other projects. The memory MCP adds only storage overage costs — no additional base fee.

---

## Convex Pricing Details

### Starter (Free) Plan

| Resource | Included | Overage Rate | Memory MCP Uses |
|----------|----------|-------------|----------------|
| Function calls | 1M/mo | $2.20/M | ~149K (15%) |
| DB storage | 0.5 GB | $0.22/GB/mo | ~70 MB/mo added |
| Search storage | 0.5 GB | $0.55/GB/mo | ~180 MB/mo added |
| DB I/O | 1 GB/mo | $0.22/GB | ~150 MB/mo |
| Action compute | 20 GB-hrs/mo | $0.33/GB-hr | ~0.05 GB-hrs |
| Data egress | 1 GB/mo | $0.132/GB | Minimal |

**Key insight:** Function calls, I/O, compute, and egress are all well within free tier. The only cost driver is **search storage** (vector indexes), which grows ~180 MB/month and exceeds the 0.5 GB free limit around month 3.

### Professional Plan ($25/developer/month)

| Resource | Included | Overage Rate | Memory MCP Uses |
|----------|----------|-------------|----------------|
| Function calls | 25M/mo | $2.00/M | ~149K (0.6%) |
| DB storage | 50 GB | $0.20/GB/mo | ~70 MB/mo (0.14%) |
| Search storage | 1 GB | $0.50/GB/mo | ~180 MB/mo (18%) |
| DB I/O | 50 GB/mo | $0.20/GB | ~150 MB/mo (0.3%) |
| Action compute | 250 GB-hrs/mo | $0.30/GB-hr | ~0.05 GB-hrs (0.02%) |
| Data egress | 50 GB/mo | $0.12/GB | Minimal |

**If you already have Pro:** The memory MCP is essentially a free rider. Search storage is the only resource that matters, and it takes 5+ months to exceed the 1 GB included.

### Marginal Cost on Existing Pro Plan

| Month | Search Storage | Monthly Overage | Cumulative Spent |
|-------|---------------|----------------|-----------------|
| 1 | 0.175 GB | $0.00 (FREE) | $0.00 |
| 3 | 0.525 GB | $0.00 (FREE) | $0.00 |
| 6 | 1.050 GB | $0.02 | $0.02 |
| 9 | 1.575 GB | $0.29 | $0.62 |
| 12 | 2.100 GB | $0.55 | $2.01 |
| 18 | 3.150 GB | $1.07 | $7.15 |
| 24 | 4.200 GB | $1.60 | $15.44 |

---

## Platform Deep Dives

### Cloudflare Workers

**Stack:** Workers + D1 (SQLite) + Vectorize (vector DB) + Workers AI (embeddings)

| Pro | Con |
|-----|-----|
| Serverless, zero maintenance | 3 services to wire together |
| Global edge deployment | Vectorize free tier very tight (~6,500 vectors at 768-dim) |
| Workers AI embeddings included | $5/mo paid tier needed within weeks |

**Why we didn't choose it:** Vectorize free tier is deceptively small. At 768 dims, you get ~6,500 vectors free — exhausted in about a week at our volume. Even at 384 dims (~13K vectors), free tier lasts only 1-2 months. The $5/mo paid tier is flat regardless of actual usage.

### Hetzner VPS + sqlite-vec

**Stack:** Node.js/Bun process + SQLite + sqlite-vec extension

| Pro | Con |
|-----|-----|
| Unlimited vectors (disk-bound) | $3.50/mo from day one |
| Simplest architecture (one file) | VPS maintenance (Docker, backups, updates) |
| sqlite-vec is pure C, zero deps | Single region, no edge |
| Pre-embed locally, VPS just stores | Cold starts if process restarts |

**Why it's a solid alternative:** If you don't use Convex and want unlimited vectors at a flat rate, this is the best option. sqlite-vec runs inside SQLite itself — no separate vector DB needed.

### AWS Serverless (Lambda + S3 + DynamoDB + Bedrock)

**Stack:** Lambda (MCP server) + S3 (vector file) + DynamoDB (metadata) + Bedrock (Titan Embed v2)

| Pro | Con |
|-----|-----|
| ~$0.50-1.40/mo actual cost | Most complex to build |
| Scales to zero when idle | Lambda cold starts (5-10s loading vectors) |
| Bedrock embeddings at $0.02/M tokens | Many AWS services to configure |
| No fixed costs | Provisioned concurrency costs $3.50/mo to fix cold starts |

**The clever trick:** Pre-compute embeddings, serialize to a single S3 file, Lambda loads into memory for brute-force KNN. At <100K vectors, in-memory search takes <50ms.

**Why we didn't choose it:** Complexity. Five AWS services vs one Convex project. And the cold start problem either hurts UX or costs $3.50/mo to fix (at which point Hetzner is simpler for the same price).

### OpenSearch Serverless — DO NOT USE

Minimum $175-350/month even when idle (2 OCU minimum). Wildly overpriced for this scale.

### Vercel + Neon (pgvector)

Vercel Postgres is dead (migrated to Neon). Neon free tier: 0.5 GB, 100 compute-hours/month. pgvector works but is bolted onto Postgres. No real advantage over Convex and more moving parts.

---

## Break-Even Analysis

When does Convex Starter's cumulative cost exceed alternatives?

| vs. | Convex exceeds at... | Vectors at that point |
|-----|---------------------|----------------------|
| Hetzner VPS ($3.50/mo) | **Month 35** (~3 years) | ~857K vectors |
| Cloudflare Paid ($5/mo) | **Month 49** (~4 years) | ~1.2M vectors |

Convex is cheaper for 3+ years at current usage rates.

---

## Scenarios

### Light Usage (50% of current volume)

766 sessions/mo, ~61K chunks, ~12K embedded

| Month | Monthly Cost | Cumulative |
|-------|-------------|-----------|
| 6 | $0.01 | $0.01 |
| 12 | $0.30 | $1.11 |
| 24 | $0.95 | $8.88 |

### Embed Everything (100% of chunks)

122K chunks/mo all embedded — 5x more vectors

| Month | Monthly Cost | Cumulative |
|-------|-------------|-----------|
| 6 | $2.62 | $8.47 |
| 12 | $5.58 | $34.51 |
| 24 | $11.55 | $140.27 |

Not recommended unless search quality testing shows significant benefit from embedding tool output.

---

## Decision

**Convex on existing Pro plan.** Marginal cost is $0 for 5 months, under $2/mo at 2 years. No new accounts, no new infrastructure, TypeScript-native, vector search built in.
