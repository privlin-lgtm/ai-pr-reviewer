"use client";

export default function DashboardError({
  reset,
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  return (
    <main className="mx-auto grid min-h-screen max-w-2xl place-items-center p-6">
      <section aria-labelledby="dashboard-error-title" className="rounded-2xl border border-rose-400/40 bg-rose-950/30 p-8">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-rose-300">Dashboard error</p>
        <h1 id="dashboard-error-title" className="mt-3 text-2xl font-semibold text-white">
          The dashboard could not be rendered.
        </h1>
        <p className="mt-3 text-slate-300">
          Refresh after resolving the server-side configuration or connection problem.
        </p>
        <button
          className="mt-6 rounded-lg bg-sky-400 px-4 py-2 font-semibold text-slate-950 hover:bg-sky-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-200"
          onClick={reset}
          type="button"
        >
          Try again
        </button>
      </section>
    </main>
  );
}
