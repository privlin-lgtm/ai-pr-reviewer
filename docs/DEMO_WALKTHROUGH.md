# AI Pull Request Reviewer: 5–7 Minute Walkthrough

## Goal and setup

**Audience:** recruiters and engineering managers  
**Length:** 5–7 minutes  
**Demo baseline:** a configured PostgreSQL + pgvector database, GitHub App, OpenAI key, and separately running worker. Use `npm run seed:demo` only for clearly labeled local dashboard data; it creates no GitHub side effects.

## 0:00–0:40 — Opening

**Show:** the README architecture diagram, then the dashboard.

**Say:**

> This is an AI Pull Request Reviewer built as a production-minded portfolio project. Its purpose is not just to generate AI comments: it receives GitHub App events safely, persists review work durably, enriches analysis with repository standards, assigns an explainable risk score, and publishes through a separate outbox.
>
> The central design choice is separating fast webhook acknowledgement from slow and fallible work such as GitHub API calls, embeddings, and AI analysis.

## 0:40–1:30 — GitHub App webhook to durable work

**Show:** `app/api/github/webhook/route.ts`, then `src/reviews/review-job-queue.ts` and the `ReviewJob`/`WebhookDelivery` Prisma models.

**Say:**

> GitHub sends a `pull_request` webhook for an opened or synchronized PR. The route reads the raw body, applies a byte limit, verifies the HMAC signature, and only accepts those two actions.
>
> Before returning a `202`, it uses PostgreSQL to rate-limit valid deliveries and persist a delivery plus idempotent review job. GitHub delivery IDs and repository/PR/head-SHA job keys prevent ordinary duplicate work.
>
> The request never calls OpenAI or posts a GitHub review. That keeps webhook response time predictable and lets GitHub retry a `503` when durable persistence is unavailable.

## 1:30–2:40 — Worker, RAG, AI findings, and risk

**Show:** a terminal with `npm run worker`, then `src/reviews/prisma-review-job-handler.ts`, `src/rag/`, `src/ai/`, and `src/risk/`.

**Say:**

> A separate worker claims jobs with PostgreSQL locking, leases, and heartbeats. Expired leases can be reclaimed after a process crash, while ownership checks avoid an active worker overwriting another worker’s state.
>
> For an active job, the handler fetches the diff and changed files using an installation-scoped GitHub App client. It also retrieves repository standards from pgvector. The index is intentionally narrow: README, CONTRIBUTING, docs, and architecture guidance—not an unbounded source-code crawl.
>
> Retrieved snippets carry stable labels like `standard:path#chunk@sha`. The AI engine treats both the diff and standards as untrusted reference material, returns JSON only, and validates it with Zod. Standard-violation claims must cite a retrieved snippet; invented citations are removed before persistence.
>
> Alongside AI findings, the risk scorer is deterministic. It scores file count, security findings, authentication changes, migrations, public API changes, and high-severity issues on a 1–10 scale. The output includes factors and reasons, so the dashboard can explain a score rather than present a black box.

## 2:40–3:35 — Persistence and publication outbox

**Show:** `Review`, `Finding`, `ReviewMetrics`, and `PublicationOutbox` in `prisma/schema.prisma`; then `src/reviews/publication-outbox.ts`.

**Say:**

> Analysis writes the review, findings, metrics, and a publication outbox record transactionally. Findings have independent `PENDING`, `SUPPRESSED`, `PUBLISHED`, and `FAILED` states—analysis completion does not pretend every comment was posted.
>
> A publisher claims the outbox record and posts only eligible inline findings. It embeds a stable hidden marker and checks GitHub for that marker before creating another review. This covers the common crash-after-success case.
>
> The honest reliability guarantee is at-least-once publication. GitHub does not accept a caller-provided idempotency key for review creation, so a narrow crash between marker lookup and the external write can still create a duplicate. That limitation is documented rather than hidden.

## 3:35–4:30 — Dashboard and authorization

**Show:** dashboard at `/`, then `src/dashboard/data.ts`, `src/dashboard/scope.ts`, and `/api/auth/github`.

**Say:**

> The dashboard is a Next.js App Router page. Server-side queries show total repositories, completed PR reviews, average risk, open findings, category distribution, and recent review history. Recharts is isolated to a client component; data loading remains server-side.
>
> Importantly, it fails closed. An unauthenticated visitor sees no metrics—not global or demo data. The GitHub OAuth flow creates or updates a user and grants membership only for installations and repositories GitHub reports and that already exist locally.
>
> Every dashboard aggregate, chart, history item, repository control, retry, and indexing request is scoped through `RepositoryMembership`. Admin and owner roles gate repository enablement, reindexing, and failed-review retry.

## 4:30–5:25 — Operations, tests, and CI

**Show:** `.github/workflows/ci.yml`, `package.json`, then a terminal:

```bash
npm run prisma:generate
npm run prisma:validate
npm test
npm run build
```

**Say:**

> The worker exposes `/healthz` for liveness and `/readyz` for PostgreSQL readiness. Its structured logs and persisted errors redact common secret, token, password, authorization, and connection-string forms. Raw webhooks, OAuth codes, diffs, and tokens are not logged.
>
> CI installs dependencies, starts a `pgvector/pgvector:pg16` PostgreSQL service, enables the extension, deploys migrations, runs typechecking, Node tests, Vitest tests, the pgvector integration test, and a Next production build.
>
> The test suite covers validation contracts, retries, webhook signature/rate-limit paths, queue and worker transitions, outbox behavior, RAG selection and snapshot safety, risk boundaries, OAuth identity handling, and mocked GitHub service behavior. The pgvector integration test runs in CI without external credentials.

## 5:25–6:15 — Challenges and tradeoffs

**Show:** README “Reliability model” and “Scope and limitations.”

**Say:**

> I deliberately chose PostgreSQL-backed queues over Redis or a managed workflow system. For a solo-developer project, that minimizes infrastructure while still providing transactional writes, locking, leases, retries, and an audit trail.
>
> Prisma models the relational metadata, while pgvector operations use parameterized raw SQL because vector values are not natively materialized by Prisma. Retrieval is always scoped by repository, branch, and embedding model to avoid cross-repository context leakage.
>
> The current membership sync depends on GitHub reporting App-accessible installations. A production deployment still needs user-provided OAuth credentials, GitHub App credentials, OpenAI credentials, managed PostgreSQL backups, and separately deployed dashboard and worker processes.

## 6:15–6:40 — Closing

**Say:**

> The value of this project is the full engineering path around AI: validated input and output, repository-aware context, explainable scoring, durable state transitions, scoped access, and documented failure semantics. It is intentionally small enough for one engineer to operate, while demonstrating the reliability boundaries I would expect in a production integration.

## Likely interviewer Q&A

| Question | Concise answer |
| --- | --- |
| Why not review in the webhook request? | GitHub expects fast delivery acknowledgement; AI and GitHub API calls are slow and retryable, so they run in durable workers. |
| How do you avoid duplicate comments? | Durable idempotency keys, claims, stored external IDs, and a hidden GitHub marker lookup reduce duplicates; GitHub’s API prevents an exactly-once guarantee. |
| How do repository standards remain safe? | The index allowlist, document limits, byte caps, truncated-tree rejection, repository/branch/model retrieval filters, and citation validation bound the context. |
| Why deterministic risk instead of AI risk? | It is stable, testable, explainable, and easy to tune; AI contributes validated findings rather than an opaque score. |
| What would you improve next? | Stronger publication reconciliation, broader installation/repository synchronization, a complete production identity rollout, richer review detail UI, and observability dashboards. |
