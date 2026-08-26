# AI-Powered GitHub PR Reviewer

## Goal

A portfolio-scale GitHub App that reviews pull requests, posts high-confidence inline feedback, assigns an explainable risk score, and preserves a searchable review history. The design favors a small, reliable system over autonomous code changes or broad repository indexing.

## System shape

```text
GitHub -> Next.js webhook -> PostgreSQL job queue -> Node review worker
                                                  |-> OpenAI (embeddings + review)
                                                  |-> GitHub API (diffs/comments)
Dashboard <-------------------------------------- PostgreSQL + pgvector
```

The Next.js application owns the dashboard, authenticated API, webhook ingestion, and Prisma schema. A separately deployed Node worker consumes database-backed jobs; it is deliberately separate from serverless request handling because diff retrieval and LLM calls can be slow or retried.

## Proposed structure

```text
app/
  (dashboard)/                 # repositories, review history, review detail
  api/
    github/webhook/route.ts    # raw-body signature verification and ingestion
    repos/route.ts
    reviews/[reviewId]/route.ts
    dashboard/stats/route.ts
  layout.tsx
components/
  dashboard/                   # charts, filters, review tables
  reviews/                     # findings, risk explanation, source context
lib/
  auth/                        # dashboard session and authorization
  github/                      # App JWT, installation token, REST client
  openai/                      # structured review and embedding clients
  prisma.ts
  security/                    # signature verification, encryption helpers
  validation/                  # Zod request and webhook schemas
services/
  ingestion/                   # event normalization and idempotency
  reviews/                     # orchestration, prompts, scoring, publication
  rag/                         # standards discovery, chunking, retrieval
  jobs/                        # enqueue, claim, retry, dead-letter policy
prisma/
  schema.prisma
worker/
  src/index.ts                 # polling loop and graceful shutdown
  src/handlers/                # analyze-pr, index-repository
```

## Major services

| Service | Responsibility |
| --- | --- |
| GitHub App client | Creates short-lived installation tokens, reads PR metadata/files, and submits reviews. |
| Webhook ingestion | Verifies delivery authenticity, deduplicates it, stores a minimal event record, and enqueues work. |
| Review orchestrator | Fetches the immutable PR head, selects changed files, builds context, calls AI, validates findings, and publishes feedback. |
| RAG standards service | Indexes approved repository guidance, embeds chunks, and retrieves relevant standards per changed file. |
| Risk scorer | Combines deterministic change signals with a constrained AI classification into an explainable `0–100` score. |
| Job runner | Claims jobs transactionally, retries transient failures with backoff, and records terminal failures. |
| Dashboard/query service | Provides repository-scoped review history, findings, risk trends, and processing status. |

## Pull-request flow

1. GitHub sends a `pull_request` webhook for `opened`, `reopened`, or `synchronize`. The webhook route reads the unmodified body, verifies `X-Hub-Signature-256`, and rejects invalid requests before JSON parsing.
2. The route stores the GitHub delivery ID in `webhook_deliveries` under a unique constraint. A duplicate returns success without scheduling duplicate work.
3. In one database transaction, it creates an `analyze_pr` `review_job` keyed by installation, repository, PR number, and head SHA. GitHub receives a fast `2xx`; no AI or GitHub API work occurs in the request.
4. The worker locks one job with `FOR UPDATE SKIP LOCKED`, obtains an installation token, and fetches PR metadata, changed files, and the head SHA. If the PR changed, the stale job is cancelled and the newer webhook job wins.
5. The worker filters generated, binary, oversized, and ignored paths. For each eligible diff, it derives deterministic signals such as security-sensitive paths, migration changes, public API changes, test coverage changes, and diff size.
6. It retrieves matching standards chunks from `repository_documents` using pgvector, scoped strictly to the same repository and current default/head branch. Relevant `.github` guidance and configured documents are prioritized.
7. OpenAI receives a structured prompt containing the diff, limited surrounding code, retrieved standards, and a JSON schema for findings. It must return only actionable findings with file, line, severity, category, rationale, and confidence.
8. The worker rejects malformed, low-confidence, duplicate, out-of-diff, or unsupported-line findings. It calculates and stores the final risk score and contributing signals.
9. The worker creates a GitHub App review with inline comments only for validated high-confidence findings; it otherwise posts a concise summary. The review, findings, and publishing outcome are persisted.
10. The dashboard reads persisted data only. It can show pending/failed states, score history, comments, and the standards sources used for each review.

## Repository-aware standards (RAG)

On installation and on relevant pushes, an `index_repository` job scans a small allowlist such as `.github/`, `docs/engineering/`, `CONTRIBUTING.md`, and `ARCHITECTURE.md`. The service chunks text with file path, branch, content SHA, and section metadata; it generates OpenAI embeddings and upserts vectors. Re-indexing is incremental by content SHA.

At review time, retrieval is constrained by `repository_id`, excludes stale/deleted chunks, and limits context to the top few chunks related to the changed file and diff. Do not index secrets, lockfiles, binaries, or arbitrary repository history. MVP can begin with explicit configured standards paths rather than full semantic codebase search.

## Data model

| Entity | Key fields and relations |
| --- | --- |
| `user` | Dashboard identity; has many `repository_memberships`. |
| `github_installation` | GitHub installation ID, account metadata, encrypted configuration; has many repositories. |
| `repository` | Installation, GitHub repository ID, owner/name, default branch, review settings; has many PRs, documents, and reviews. |
| `pull_request` | Repository, GitHub PR number, base/head SHA, author, state; has many reviews. Unique on repository + PR number. |
| `review` | Pull request, analyzed head SHA, status, model/version, score, summary, GitHub review ID; has many findings. Unique on pull request + head SHA. |
| `review_finding` | Review, path, start/end line, side, severity, category, confidence, rationale, published comment ID. |
| `risk_signal` | Review, signal name, score contribution, evidence JSON; supports score explainability. |
| `repository_document` | Repository, path, branch, content SHA, chunk text, embedding vector, metadata. Unique on repository + path + branch + chunk index + SHA. |
| `webhook_delivery` | GitHub delivery ID, event/action, received time, payload hash, processing state. Unique delivery ID enforces idempotency. |
| `review_job` | Type, repository/PR/head SHA, status, attempts, run-after, locked-at/by, error. Unique active job identity prevents duplicate analysis. |

Use PostgreSQL foreign keys, tenant-scoped indexes (especially `repository_id`), and `pgvector` for embeddings. Store only metadata and hashes for raw webhook bodies unless temporary payload retention is required for debugging.

## API surface

| Endpoint | Purpose |
| --- | --- |
| `POST /api/github/webhook` | Public GitHub-only ingress; signature verified and rate-limited. |
| `GET /api/repos` | Lists repositories available to the signed-in dashboard user. |
| `GET /api/repos/:repoId/reviews` | Paginated review history, filterable by PR, status, and risk range. |
| `GET /api/reviews/:reviewId` | Review detail, findings, signals, and standards provenance. |
| `POST /api/reviews/:reviewId/retry` | Explicit, authorized retry for a failed review; creates a new idempotent job. |
| `GET /api/dashboard/stats` | Aggregated, repository-scoped risk and processing metrics. |

Dashboard routes require an authenticated user and repository membership. Worker-only operations are not exposed as HTTP APIs.

## Security and reliability

- Validate the GitHub webhook HMAC against the raw body with a timing-safe comparison. Require a configured secret, enforce a small body limit, and log only redacted metadata.
- Treat GitHub delivery IDs and review head SHAs as idempotency keys. Queue first, acknowledge quickly, and make publication idempotent using the persisted GitHub review/comment IDs.
- Authenticate as a GitHub App using a short-lived JWT signed by a protected private key. Request installation tokens on demand, cache only until expiry, use least-privilege permissions, and never expose app credentials to the browser.
- Enforce repository and installation ownership on every dashboard query and retrieval query. Encrypt configuration secrets at rest and keep OpenAI/GitHub secrets in the deployment secret manager.
- Use transactional job claims, exponential retry for GitHub/OpenAI `429` and `5xx` responses, bounded attempts, and a visible failed/dead-letter state. Do not retry invalid signatures, validation errors, or unsupported diffs.
- Pin analysis to the webhook head SHA; cancel or supersede jobs when a newer SHA arrives. Limit token size, file count, and per-review cost; record model and prompt version for auditability.
- Ask the model for structured data, validate it server-side, and never execute model output. Keep a human-visible confidence threshold and permit an opt-out/ignore-path configuration.

## Deployment

Deploy the Next.js application on Vercel (or a single Docker host) with environment-managed secrets. Deploy the worker as a separate long-running Docker service on Railway, Fly.io, or a small VM. Use managed PostgreSQL with daily backups, TLS, Prisma migrations run in CI/CD, and the pgvector extension enabled. OpenAI and GitHub remain external managed APIs.

Operational telemetry should include webhook acceptance/rejection, job latency and retry count, token/model usage, review publication failures, and worker health. Configure GitHub webhook delivery retries as the ingress safety net; the application queue is the processing safety net.

## Achievable MVP

Build only the following first:

1. GitHub App installation for selected repositories, signed webhook ingestion, and database-backed asynchronous PR analysis.
2. Analysis for TypeScript/JavaScript text diffs with file/size limits, one structured OpenAI review call, risk score, and high-confidence GitHub inline comments plus a summary.
3. A dashboard for repository selection, review history, review detail, score explanation, and failed-job retry.
4. RAG limited to configured Markdown guidance files with incremental embeddings and repository-scoped retrieval.

Defer multi-language parsing, automatic fixes, organization-wide policy administration, real-time streaming, full-code semantic search, custom fine-tuning, billing, and autonomous merge approval. These can be added only after the core webhook-to-published-review path is demonstrably reliable.
