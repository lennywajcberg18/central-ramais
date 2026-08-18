import type { Metadata } from 'next';

// A tela é 'use client' e página cliente não pode exportar metadata. Este layout
// de servidor existe só para dar título próprio à rota — sem ele o leitor de tela
// anuncia o mesmo "Central de Ramais" ao trocar de Atendimento para Ramais.
export const metadata: Metadata = { title: 'Atendimento' };

export default function ConversasLayout({ children }: { children: React.ReactNode }) {
  return children;
}
