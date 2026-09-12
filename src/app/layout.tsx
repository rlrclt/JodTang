import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Sans_Thai } from 'next/font/google';

import './globals.css';

// design.md §1.2: โหลด 400/600/700 เท่านั้น (ไม่โหลด 5 น้ำหนัก) + subset ไทย + display swap
const thai = IBM_Plex_Sans_Thai({
  subsets: ['thai', 'latin'],
  weight: ['400', '600', '700'],
  display: 'swap',
  variable: '--font-thai',
});

export const metadata: Metadata = {
  title: 'จดจ่าย',
  description: 'บันทึกรายรับรายจ่ายให้เสร็จในไม่กี่วินาที',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'จดจ่าย', statusBarStyle: 'default' },
};

// design.md §6: แถบสถานะกลืนกับแอป (คนละค่าตามธีมอุปกรณ์)
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#EAEFF4' },
    { media: '(prefers-color-scheme: dark)', color: '#0B1220' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={thai.variable}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
