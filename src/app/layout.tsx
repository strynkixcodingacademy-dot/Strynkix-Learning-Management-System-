import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, Geist_Mono, Manrope } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/context/AuthContext';
import { Toaster } from '@/components/ui/Toaster';
import { MotionProvider } from '@/components/ui/Motion';
import { THEME_SCRIPT } from '@/lib/theme';

const manrope = Manrope({
  variable: '--font-manrope',
  subsets: ['latin'],
  display: 'swap',
});

const bricolage = Bricolage_Grotesque({
  variable: '--font-bricolage',
  subsets: ['latin'],
  display: 'swap',
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
  display: 'swap',
});

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: '#f5f6fb',
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
    <html lang="en" data-theme="light" suppressHydrationWarning className={`${manrope.variable} ${bricolage.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col bg-canvas text-ink">
        <MotionProvider>
          <AuthProvider>{children}</AuthProvider>
        </MotionProvider>
        <Toaster />
      </body>
    </html>
  );
}
