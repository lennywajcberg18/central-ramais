import type { Metadata } from 'next';

// Mesmo motivo do layout de /conversas: título por rota, já que a página é cliente.
// Aqui vale dobrado — cair no login é o que acontece quando o plantão encerra no
// meio do uso, e o título é a primeira confirmação de que a tela mudou.
export const metadata: Metadata = { title: 'Entrar' };

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
