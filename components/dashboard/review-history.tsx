import type { DashboardReviewHistoryItem } from "../../src/dashboard/types";

const riskClasses = {
  CRITICAL: "bg-rose-500/15 text-rose-200",
  HIGH: "bg-orange-500/15 text-orange-200",
  LOW: "bg-emerald-500/15 text-emerald-200",
  MEDIUM: "bg-amber-500/15 text-amber-200",
  UNASSESSED: "bg-slate-700 text-slate-300",
} as const;

export function ReviewHistory({ history }: Readonly<{ history: DashboardReviewHistoryItem[] }>) {
  if (history.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-700 p-6 text-sm text-slate-400">
        No completed reviews yet. Install the GitHub App and open or synchronize a pull request to populate review history.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <caption className="sr-only">Recent pull request review history</caption>
        <thead className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-3 font-semibold">Pull request</th>
            <th className="px-3 py-3 font-semibold">Repository</th>
            <th className="px-3 py-3 font-semibold">Risk</th>
            <th className="px-3 py-3 font-semibold">Findings</th>
            <th className="px-3 py-3 font-semibold">Status</th>
            <th className="px-3 py-3 font-semibold">Reviewed</th>
          </tr>
        </thead>
        <tbody>
          {history.map((review) => (
            <tr key={review.id} className="border-b border-slate-800/80 text-slate-300">
              <td className="max-w-80 px-3 py-4">
                <p className="font-medium text-white">#{review.pullRequestNumber} {review.title}</p>
              </td>
              <td className="px-3 py-4 text-slate-400">{review.repositoryName}</td>
              <td className="px-3 py-4">
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${riskClasses[review.riskCategory]}`}>
                  {review.riskScore ?? "—"} · {review.riskCategory}
                </span>
              </td>
              <td className="px-3 py-4">{review.findingCount}</td>
              <td className="px-3 py-4">{review.status}</td>
              <td className="px-3 py-4 text-slate-400">
                {new Intl.DateTimeFormat("en", {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(review.createdAt))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
