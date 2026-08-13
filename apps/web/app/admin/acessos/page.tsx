'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface AttemptRow {
  id: string;
  waNumber: string;
  entryCodeTried: string | null;
  reason: string;
  createdAt: string;
}

const REASON_LABEL: Record<string, string> = {
  no_code: 'Sem código',
  invalid_code: 'Código inválido',
  revoked_link: 'Link revogado',
  nominal_taken: 'Link nominal já usado',
  blocked: 'Contato bloqueado',
};

export default function AcessosPage() {
  const [rows, setRows] = useState<AttemptRow[]>([]);

  useEffect(() => {
    api<AttemptRow[]>('/admin/access-attempts').then(setRows);
  }, []);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Acessos negados</h2>
        <p className="text-sm text-slate-500">
          Pico de “link nominal já usado” significa que alguém repassou um link nominal.
        </p>
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-2">Quando</th>
              <th className="px-4 py-2">Número</th>
              <th className="px-4 py-2">Código tentado</th>
              <th className="px-4 py-2">Motivo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr
                key={a.id}
                className={`border-t border-slate-100 ${
                  a.reason === 'nominal_taken' ? 'bg-red-50' : ''
                }`}
              >
                <td className="px-4 py-2 text-slate-500">
                  {new Date(a.createdAt).toLocaleString('pt-BR')}
                </td>
                <td className="px-4 py-2 font-mono">{a.waNumber}</td>
                <td className="px-4 py-2 font-mono">{a.entryCodeTried ?? '—'}</td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      a.reason === 'nominal_taken'
                        ? 'bg-red-100 font-medium text-red-700'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {REASON_LABEL[a.reason] ?? a.reason}
                  </span>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                  Nenhuma tentativa negada.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
