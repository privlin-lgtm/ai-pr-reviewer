export default function LoadingDashboard() {
  return (
    <main aria-busy="true" className="mx-auto min-h-screen max-w-7xl p-6 lg:p-10">
      <p className="text-sm font-medium text-sky-300">Loading review dashboard…</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div
            key={item}
            className="h-32 animate-pulse rounded-2xl border border-slate-700 bg-slate-900"
          />
        ))}
      </div>
    </main>
  );
}
