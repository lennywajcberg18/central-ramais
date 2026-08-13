'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Department {
  id: string;
  name: string;
  active: boolean;
}

interface UserRow {
  id: string;
  role: 'admin' | 'agent';
  name: string;
  email: string;
  active: boolean;
  availability: string;
  departmentNames: string[];
}

export default function AgentesPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'agent' as const });
  const [selectedDepts, setSelectedDepts] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [u, d] = await Promise.all([
      api<UserRow[]>('/admin/users'),
      api<Department[]>('/admin/departments'),
    ]);
    setUsers(u);
    setDepartments(d.filter((x) => x.active));
  }

  useEffect(() => {
    load();
  }, []);

  async function createUser(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/admin/users', {
        method: 'POST',
        body: JSON.stringify({ ...form, departmentIds: selectedDepts }),
      });
      setForm({ name: '', email: '', password: '', role: 'agent' });
      setSelectedDepts([]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'erro ao criar usuário');
    }
  }

  async function toggleActive(u: UserRow) {
    await api(`/admin/users/${u.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ active: !u.active }),
    });
    await load();
  }

  return (
    <div className="max-w-3xl space-y-6">
      <h2 className="text-lg font-semibold">Agentes</h2>

      <form onSubmit={createUser} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid grid-cols-3 gap-2">
          <input
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Nome"
            className="rounded-lg border border-slate-300 px-3 py-2"
          />
          <input
            required
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="E-mail"
            className="rounded-lg border border-slate-300 px-3 py-2"
          />
          <input
            required
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="Senha (mín. 6)"
            className="rounded-lg border border-slate-300 px-3 py-2"
          />
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          {departments.map((d) => (
            <label key={d.id} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={selectedDepts.includes(d.id)}
                onChange={(e) =>
                  setSelectedDepts((prev) =>
                    e.target.checked ? [...prev, d.id] : prev.filter((x) => x !== d.id)
                  )
                }
              />
              {d.name}
            </label>
          ))}
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700">
          Criar agente
        </button>
      </form>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-2">Nome</th>
              <th className="px-4 py-2">E-mail</th>
              <th className="px-4 py-2">Setores</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-slate-100">
                <td className="px-4 py-2 font-medium">
                  {u.name} {u.role === 'admin' && <span className="text-xs text-slate-400">(admin)</span>}
                </td>
                <td className="px-4 py-2">{u.email}</td>
                <td className="px-4 py-2">{u.departmentNames.join(', ') || '—'}</td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      u.active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {u.active ? u.availability : 'inativo'}
                  </span>
                </td>
                <td className="px-4 py-2 text-right">
                  <button onClick={() => toggleActive(u)} className="text-sm text-blue-600">
                    {u.active ? 'Desativar' : 'Reativar'}
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
