import type { Metadata } from 'next';

// Mesmo motivo do layout de /conversas: título por rota, já que a página é cliente.
export const metadata: Metadata = { title: 'Ramais' };

export default function RamaisLayout({ children }: { children: React.ReactNode }) {
  return children;
}
