'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Metrics {
  volume: number;
  frtAvgMinutes: number | null;
  assignAvgMinutes: number | null;
  resolutionAvgMinutes: number | null;
  slaPct: number | null;
  csatAvg: number | null;
  csatResponseRate: number | null;
  abandonmentPct: number | null;
  byDepartment: { departmentId: string; name: string; volume: number }[];
  byLink: { entryLinkId: string; label: string; volume: number; contacts: number }[];
  byKind: { profile: number; nominal: number };
  attemptsByReason: Record<string, number>;
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function Card({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-500">{title}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}

export default function DashboardPage() {
  const [from, setFrom] = useState(iso(new Date(Date.now() - 29 * 24 * 60 * 60 * 1000)));
  const [to, setTo] = useState(iso(new Date()));
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  const load = useCallback(async () => {
    const data = await api<Metrics>(
      `/admin/metrics?from=${from}T00:00:00&to=${to}T23:59:59`
    );
    setMetrics(data);
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const fmt = (v: number | null, suffix = '') => (v == null ? '—' : `${v}${suffix}`);

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-end justify-between">
        <h2 className="text-lg font-semibold">Dashboard</h2>
        <div className="flex items-center gap-2 text-sm">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-lg border border-slate-300 px-2 py-1"
          />
          <span className="text-slate-400">até</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-lg border border-slate-300 px-2 py-1"
          />
        </div>
      </div>

      {metrics && (
        <>
          <div className="grid grid-cols-4 gap-3">
            <Card title="Conversas" value={String(metrics.volume)} />
            <Card title="FRT médio" value={fmt(metrics.frtAvgMinutes, ' min')} />
            <Card title="Resolução média" value={fmt(metrics.resolutionAvgMinutes, ' min')} />
            <Card title="SLA (FRT < 5 min)" value={fmt(metrics.slaPct, '%')} />
            <Card title="CSAT médio" value={fmt(metrics.csatAvg)} />
            <Card title="Resposta CSAT" value={fmt(metrics.csatResponseRate, '%')} />
            <Card title="Abandono (timeout)" value={fmt(metrics.abandonmentPct, '%')} />
            <Card
              title="Perfil × Nominal"
              value={`${metrics.byKind.profile} × ${metrics.byKind.nominal}`}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h3 className="mb-2 text-sm font-medium text-slate-600">Por setor</h3>
              <table className="w-full text-sm">
                <tbody>
                  {metrics.byDepartment.map((d) => (
                    <tr key={d.departmentId} className="border-t border-slate-100">
                      <td className="py-1.5">{d.name}</td>
                      <td className="py-1.5 text-right font-medium">{d.volume}</td>
                    </tr>
                  ))}
                  {metrics.byDepartment.length === 0 && (
                    <tr>
                      <td className="py-3 text-center text-slate-400">Sem dados no período</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h3 className="mb-2 text-sm font-medium text-slate-600">Por link</h3>
              <table className="w-full text-sm">
                <tbody>
                  {metrics.byLink.map((l) => (
                    <tr key={l.entryLinkId} className="border-t border-slate-100">
                      <td className="py-1.5">{l.label}</td>
                      <td className="py-1.5 text-right text-slate-500">{l.contacts} contatos</td>
                      <td className="py-1.5 text-right font-medium">{l.volume}</td>
                    </tr>
                  ))}
                  {metrics.byLink.length === 0 && (
                    <tr>
                      <td className="py-3 text-center text-slate-400">Sem dados no período</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="mb-2 text-sm font-medium text-slate-600">Tentativas negadas (por motivo)</h3>
            <div className="flex flex-wrap gap-3 text-sm">
              {Object.entries(metrics.attemptsByReason).map(([reason, count]) => (
                <span
                  key={reason}
                  className={`rounded-full px-3 py-1 ${
                    reason === 'nominal_taken'
                      ? 'bg-red-100 font-medium text-red-700'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {reason}: {count}
                </span>
              ))}
              {Object.keys(metrics.attemptsByReason).length === 0 && (
                <span className="text-slate-400">Nenhuma no período</span>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
