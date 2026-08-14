import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jakarta',
});

export const metadata: Metadata = {
  title: 'Central de Ramais',
  description:
    'O hospital decide quem, de fora, fala com cada setor pelo WhatsApp — sem expor número de ninguém.',
  icons: {
    icon: [
      {
        url:
          'data:image/svg+xml,' +
          encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#26705f"/><path d="M13 7h6v6h6v6h-6v6h-6v-6H7v-6h6z" fill="#fff"/></svg>`
          ),
        type: 'image/svg+xml',
      },
    ],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={jakarta.variable}>
      <body className="min-h-dvh bg-ink-50 font-sans text-ink-800 antialiased">{children}</body>
    </html>
  );
}
