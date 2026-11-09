import type { Metadata, Viewport } from 'next';
import { JetBrains_Mono, Literata, Schibsted_Grotesk } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/context/AuthContext';

const schibsted = Schibsted_Grotesk({
  variable: '--font-schibsted',
  subsets: ['latin'],
  display: 'swap',
});

// One book face for titles, covers and reading; its optical-size axis
// tightens it at display sizes and opens it up for body text.
const literata = Literata({
  variable: '--font-literata',
  subsets: ['latin'],
  style: ['normal', 'italic'],
  axes: ['opsz'],
  display: 'swap',
});

const jetbrains = JetBrains_Mono({
  variable: '--font-jetbrains',
  subsets: ['latin'],
  display: 'swap',
});

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#faf9f6',
};

export const metadata: Metadata = {
  title: 'Strynkix Live Books',
  description: 'The learning space of Strynkix Coding Academy: daily plans, Live Book lessons, assignments and progress.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${schibsted.variable} ${literata.variable} ${jetbrains.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-canvas text-ink">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
