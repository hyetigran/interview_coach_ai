import type { Metadata } from 'next';
import '@fontsource-variable/inter';
import './globals.css';
import { QueryProvider } from '@/components/query-provider';
export const metadata: Metadata = { title: 'Interview Coach', description: 'A private workspace to reflect on interviews and prepare a clearer next answer.' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" className="h-full antialiased"><body className="min-h-full"><QueryProvider>{children}</QueryProvider></body></html>;
}
