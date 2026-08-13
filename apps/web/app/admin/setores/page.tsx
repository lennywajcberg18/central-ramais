'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Department {
  id: string;
  name: string;
  menuKey: string;
  active: boolean;
  sortOrder: number;
}

export default function SetoresPage() {
  const [rows, setRows] = useState<Department[]>([]);
  const [name, setName] = useState('');

  async function load() {
    setRows(await api<Department[]>('/admin/departments'));
  }

  useEffect(() => {
    load();
  }, []);

  async function createDepartment(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await api('/admin/departments', { method: 'POST', body: JSON.stringify({ name: name.trim() }) });
    setName('');
    await load();
  }

  async function toggleActive(d: Department) {
    await api(`/admin/departments/${d.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ active: !d.active }),
    });
    await load();
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h2 className="text-lg font-semibold">Setores</h2>

      <form onSubmit={createDepartment} className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome do setor"
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-blue-500"
        />
        <button className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700">
          Adicionar
        </button>
      </form>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-2">Opção</th>
              <th className="px-4 py-2">Nome</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id} className="border-t border-slate-100">
                <td className="px-4 py-2">{d.menuKey}</td>
                <td className="px-4 py-2 font-medium">{d.name}</td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      d.active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {d.active ? 'Ativo' : 'Inativo'}
                  </span>
                </td>
                <td className="px-4 py-2 text-right">
                  <button onClick={() => toggleActive(d)} className="text-sm text-blue-600">
                    {d.active ? 'Desativar' : 'Reativar'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
