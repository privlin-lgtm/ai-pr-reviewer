import { cookies } from "next/headers";

import { CategoryChart } from "../components/dashboard/category-chart";
import { ReviewHistory } from "../components/dashboard/review-history";
import { StatCard } from "../components/dashboard/stat-card";
import {
  readGitHubAppSessionValue,
  tryLoadGitHubAppIdentityConfig,
} from "../src/auth/github-app-identity";
import { loadDashboardData } from "../src/dashboard/data";
import {
  resolveDashboardScope,
  type DashboardIdentity,
} from "../src/dashboard/scope";
import type { DashboardData } from "../src/dashboard/types";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const identity = await getDashboardIdentity();
  const databaseConfigured =
    process.env.DATABASE_URL !== undefined &&
    process.env.DATABASE_URL.trim().length > 0;
  const result =
    !databaseConfigured
      ? { status: "unconfigured" as const }
      : await resolveAndLoadDashboardData(identity);

  return (
    <main className="mx-auto min-h-screen max-w-7xl p-6 lg:p-10">
      <header className="flex flex-col gap-4 border-b border-slate-800 pb-7 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-sky-300">AI PR Reviewer</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">Review health dashboard</h1>
          <p className="mt-2 max-w-2xl text-slate-400">
            Pull request reviews, deterministic risk, and actionable findings across connected repositories.
          </p>
        </div>
        <p className="text-sm text-slate-500">Server-rendered from PostgreSQL</p>
      </header>

      {result.status === "unconfigured" ? (
        <DatabaseNotice
          title="Database configuration is required"
          message="Set DATABASE_URL on the server, run Prisma migrations, and refresh this page to load live dashboard data."
        />
      ) : null}

      {result.status === "unauthenticated" ? (
        <DatabaseNotice
          title="Sign in required"
          message="Sign in with GitHub after configuring the App callback and session secret. Until then, this dashboard intentionally displays no repository data."
          action={{ href: "/api/auth/github", label: "Connect GitHub" }}
        />
      ) : null}

      {result.status === "unavailable" ? (
        <DatabaseNotice title="Dashboard data is unavailable" message={result.message} />
      ) : null}

      {result.status === "ready" ? <DashboardContent data={result.data} /> : null}
    </main>
  );
}

async function resolveAndLoadDashboardData(
  identity: DashboardIdentity | null,
) {
  if (identity === null) {
    return loadDashboardData(null);
  }

  const { prisma } = await import("../src/lib/prisma");
  return loadDashboardData(await resolveDashboardScope(prisma, identity));
}

async function getDashboardIdentity(): Promise<DashboardIdentity | null> {
  const config = tryLoadGitHubAppIdentityConfig();
  if (config === null) {
    return null;
  }
  const cookieStore = await cookies();
  const session = readGitHubAppSessionValue(
    cookieStore.get(config.sessionCookieName)?.value ?? null,
    config,
  );
  return session === null ? null : { userId: session.userId };
}

function DashboardContent({
  data,
}: Readonly<{ data: DashboardData }>) {
  return (
    <>
      <section aria-label="Review metrics" className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          description="GitHub repositories connected to the reviewer"
          label="Total repositories"
          value={data.metrics.totalRepositories}
        />
        <StatCard
          description="Completed pull request analyses"
          label="Pull requests reviewed"
          value={data.metrics.pullRequestsReviewed}
        />
        <StatCard
          description="Average deterministic score across assessed reviews"
          label="Average risk score"
          value={data.metrics.averageRiskScore ?? "—"}
        />
        <StatCard
          description="Findings waiting to be published or resolved"
          label="Open findings"
          value={data.metrics.openFindings}
        />
      </section>

      <section className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <section aria-labelledby="categories-title" className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
          <div className="mb-5">
            <h2 id="categories-title" className="text-lg font-semibold text-white">Most common issue categories</h2>
            <p className="mt-1 text-sm text-slate-400">Top categories across all persisted findings.</p>
          </div>
          <CategoryChart categories={data.categories} />
        </section>

        <section aria-labelledby="history-title" className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5">
          <div className="mb-5">
            <h2 id="history-title" className="text-lg font-semibold text-white">Review history</h2>
            <p className="mt-1 text-sm text-slate-400">The 12 most recent pull request review runs.</p>
          </div>
          <ReviewHistory history={data.history} />
        </section>
      </section>
    </>
  );
}

function DatabaseNotice({
  action,
  message,
  title,
}: Readonly<{
  action?: { href: string; label: string };
  message: string;
  title: string;
}>) {
  return (
    <section aria-labelledby="database-notice-title" className="mt-7 rounded-2xl border border-amber-400/40 bg-amber-950/25 p-6">
      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-300">Development dashboard</p>
      <h2 id="database-notice-title" className="mt-2 text-xl font-semibold text-white">{title}</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">{message}</p>
      {action === undefined ? null : (
        <a
          className="mt-4 inline-flex rounded-lg bg-sky-400 px-3 py-2 text-sm font-semibold text-slate-950 transition hover:bg-sky-300"
          href={action.href}
        >
          {action.label}
        </a>
      )}
    </section>
  );
}
