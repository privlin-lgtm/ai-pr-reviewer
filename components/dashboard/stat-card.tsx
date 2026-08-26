interface StatCardProps {
  description: string;
  label: string;
  value: string | number;
}

export function StatCard({ description, label, value }: Readonly<StatCardProps>) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-sm">
      <p className="text-sm font-medium text-slate-400">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-white">{value}</p>
      <p className="mt-2 text-sm text-slate-500">{description}</p>
    </section>
  );
}
