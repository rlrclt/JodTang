import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Sans_Thai } from 'next/font/google';

import { AddEntryFab } from '@/components/AddEntrySheet';
import { OfflineBar } from '@/components/Pwa';
import { TabBar } from '@/components/TabBar';

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

/**
 * ธีมตามระบบ (design.md §1.7 ใช้คลาส .dark ที่ <html> ไม่ใช่ prefers-color-scheme ใน CSS)
 * ยิงก่อน paint เพื่อไม่ให้จอวาบสว่างแล้วค่อยมืด · หน้าตั้งค่าจะสลับเองได้โดยเซ็ตคลาสเดียวกันทับ
 */
const THEME_SCRIPT = `(function(){try{var m=matchMedia('(prefers-color-scheme: dark)');var set=function(){document.documentElement.classList.toggle('dark',m.matches)};set();m.addEventListener('change',set)}catch(e){}})()`;

/** ไอคอน: symbol ประกาศครั้งเดียว ใช้ซ้ำด้วย <use> (ไอคอนเดี่ยวต้อง aria-hidden, ปุ่มมี aria-label) */
function IconSprite() {
  return (
    <svg className="absolute size-0 overflow-hidden" aria-hidden="true" focusable="false">
      <symbol id="i-home" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-5H9v5H5a1 1 0 0 1-1-1z" />
      </symbol>
      <symbol id="i-list" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M5 7h14M5 12h14M5 17h9" />
      </symbol>
      <symbol id="i-chart" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M5 19v-8M12 19V5M19 19v-5" />
      </symbol>
      <symbol id="i-gear" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" />
        <path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.35 17.66l-1.42 1.41M19.07 4.93l-1.41 1.42" />
      </symbol>
      <symbol id="i-plus" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M12 5v14M5 12h14" />
      </symbol>
      <symbol id="i-search" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <circle cx="11" cy="11" r="6.5" />
        <path d="M16 16l4 4" />
      </symbol>
      <symbol id="i-back" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 5h12a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H8L2 12z" />
        <path d="M16.5 9.5l-5 5M11.5 9.5l5 5" />
      </symbol>
      <symbol id="i-chevron-left" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.5 5.5L8 12l6.5 6.5" />
      </symbol>
      <symbol id="i-chevron-right" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9.5 5.5L16 12l-6.5 6.5" />
      </symbol>
    </svg>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={thai.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <IconSprite />
        {/* design.md §6: แถบ "ออฟไลน์อยู่" + ลงทะเบียน service worker (บนสุดเพื่อให้เห็นทันทีไม่ต้องเลื่อน) */}
        <OfflineBar />
        {/* max-w 430 + กลางจอ (design §1.3) · padding-bottom เว้นที่ให้แถบแท็บ + safe area (§2) */}
        <main className="mx-auto w-full max-w-[430px] px-4 pt-[calc(16px+env(safe-area-inset-top))] pb-[calc(var(--tab-h)+72px+env(safe-area-inset-bottom))]">
          {children}
        </main>
        <AddEntryFab />
        <TabBar />
      </body>
    </html>
  );
}
