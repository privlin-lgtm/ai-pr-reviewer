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

### GitHub App configuration

The integration layer reads these deployment-managed environment variables only:

| Variable | Purpose |
| --- | --- |
| `GITHUB_APP_ID` | GitHub App identifier used to mint installation tokens. |
| `GITHUB_APP_PRIVATE_KEY` | GitHub App private key; escaped newlines are normalized at runtime. |
| `GITHUB_WEBHOOK_SECRET` | Shared secret used to verify `X-Hub-Signature-256` against the raw request body. |

The HTTP adapter must pass the unmodified body and normalized GitHub headers to `PullRequestWebhookHandler`. It verifies the signature before parsing, accepts only `pull_request.opened` and `pull_request.synchronize`, and hands accepted events to the durable job enqueuer. `OctokitPullRequestService` obtains a short-lived installation client per operation, retrieves diffs/files, publishes reviews, and retries only transport failures, `408`, `429`, and `5xx` responses with bounded exponential backoff.

### Database configuration

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection URL used by `prisma.config.ts` for Prisma Migrate and by `src/lib/prisma.ts` for the `PrismaPg` driver adapter. |

The connection URL is intentionally outside `schema.prisma` for Prisma 7 compatibility. Keep it in the deployment secret manager or an ignored local `.env` file; do not expose it to browser code.

### AI review configuration

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Server-only API key used by the OpenAI review adapter. |
| `OPENAI_REVIEW_MODEL` | Optional model override for reviews; the integration defaults to `gpt-4.1-mini`. |
| `OPENAI_EMBEDDING_MODEL` | Optional embedding-model override; it must produce the migration's fixed 1536 dimensions. |
| `RAG_RETRIEVAL_LIMIT` | Optional positive cap on standards chunks injected into one review; defaults to `6`. |

`AIReviewEngine` accepts a bounded diff and optional repository standards, requests JSON-only review output, validates it with Zod, and maps each finding to the existing Prisma `Finding` fields. `RagReviewContextProvider` can be injected into the engine to retrieve repository-specific standards before prompt construction. The review worker remains responsible for persisting results, assigning a `Review`, and publishing approved comments.

### Repository standards RAG

`RepositoryStandardsIndexer` retrieves and indexes only `README.md`, `CONTRIBUTING.md`, `docs/*`, and `architecture/*`. It normalizes text, creates overlapping chunks, batches OpenAI embeddings with bounded retry, and atomically upserts a version identified by repository, branch, path, content SHA, and chunk index. Reindexing removes stale SHA versions only after the replacement succeeds.

The `RepositoryDocument` Prisma model declares its `vector(1536)` column as `Unsupported` to retain schema-drift awareness, while `prisma/migrations/20260826210000_init/migration.sql` creates the pgvector column and HNSW cosine index. `PgVectorRepositoryDocumentStore` uses parameterized Prisma raw queries because Prisma cannot natively materialize pgvector values. Retrieval always filters by repository ID, branch, and embedding model before cosine ordering, so standards cannot cross repository or embedding-version boundaries. The target PostgreSQL instance must permit `CREATE EXTENSION vector` and support pgvector HNSW indexes.

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
| `User` | Dashboard identity linked to GitHub and authorized through repository memberships. |
| `GitHubInstallation` | GitHub App installation/account identity; has many repositories and an optional installing user. |
| `RepositoryMembership` | User-to-repository authorization with an explicit role. |
| `Repository` | Installation, GitHub repository identity, default branch, and review configuration; has many pull requests. |
| `RepositoryDocument` | Versioned, repository/branch-scoped standards chunk metadata; raw pgvector embedding storage enables semantic retrieval. |
| `PullRequest` | Repository, GitHub PR identity, author, branches, SHAs, and lifecycle state; has many reviews. |
| `Review` | Pull request revision, processing status, trigger, risk score, model metadata, and GitHub review identity; has many findings. |
| `Finding` | Review-local, deduplicated AI feedback with diff location, severity, confidence, evidence, and publication state. |
| `ReviewMetrics` | One-to-one aggregate for OpenAI token use, cost, analysis scope, published-comment count, and duration. |

Use PostgreSQL foreign keys, tenant-scoped indexes (especially `repository_id`), and `pgvector` for embeddings. Store only metadata and hashes for raw webhook bodies unless temporary payload retention is required for debugging.

### Prisma schema index rationale

`prisma/schema.prisma` keeps indexing intentionally small for an MVP while supporting the dashboard and worker's hot paths:

| Index or constraint | Reason |
| --- | --- |
| Unique GitHub IDs on users, installations, repositories, PRs, reviews, and comments | Makes webhook/API upserts idempotent and prevents GitHub objects from being duplicated. |
| `Repository.installationId` and `RepositoryMembership.repositoryId` | Supports resolving an installation webhook and checking repository membership; PostgreSQL does not automatically index foreign keys. |
| Unique membership on user + repository | Enforces one authorization record per user/repository while efficiently listing a user's repositories. |
| Pull request unique repository + number, plus repository + state + GitHub update time | Supports GitHub identity, active-PR filtering, and the default dashboard ordering without a table scan. |
| Review unique PR + head SHA, plus PR + creation time and status + creation time | Avoids duplicate analysis of one revision, provides review history, and exposes queued/failed work efficiently. |
| Finding unique review + fingerprint and review + status + severity | Suppresses duplicate AI findings and serves review-detail filtering without an additional index per column. |
| One-to-one `ReviewMetrics.reviewId` | Keeps aggregate OpenAI usage and duration aligned with exactly one review without duplicating metrics rows. |

Application validation must keep `Review.riskScore` in the `0–100` range and `Finding.confidence` in the `0.00–1.00` range. This leaves range rules close to the review/scoring logic while Prisma manages the relational constraints.

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
