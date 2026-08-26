"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { DashboardCategory } from "../../src/dashboard/types";

export function CategoryChart({ categories }: Readonly<{ categories: DashboardCategory[] }>) {
  if (categories.length === 0) {
    return <p className="text-sm text-slate-400">No finding categories have been recorded yet.</p>;
  }

  return (
    <div className="h-72" role="img" aria-label="Bar chart of the most common issue categories">
      <ResponsiveContainer height="100%" width="100%">
        <BarChart data={categories} layout="vertical" margin={{ left: 10, right: 24 }}>
          <CartesianGrid horizontal={false} stroke="#334155" />
          <XAxis allowDecimals={false} stroke="#94a3b8" type="number" />
          <YAxis dataKey="category" stroke="#cbd5e1" type="category" width={116} />
          <Tooltip
            contentStyle={{
              background: "#0f172a",
              border: "1px solid #334155",
              borderRadius: "0.75rem",
            }}
            cursor={{ fill: "#1e293b" }}
          />
          <Bar dataKey="count" fill="#38bdf8" name="Findings" radius={[0, 6, 6, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
