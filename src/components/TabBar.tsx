'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// design.md §3: 4 แท็บ เรียงซ้าย→ขวา · แถบสูง 56 + safe area (§2) · z-index 20 (§1.6)
const TABS = [
  { href: '/', icon: 'i-home', label: 'หน้าแรก' },
  { href: '/transactions', icon: 'i-list', label: 'รายการ' },
  { href: '/summary', icon: 'i-chart', label: 'สรุป' },
  { href: '/settings', icon: 'i-gear', label: 'ตั้งค่า' },
] as const;

export function TabBar() {
  const pathname = usePathname();

  // หน้าเข้าสู่ระบบไม่มีแท็บ (ยังไม่ล็อกอิน = ยังไม่มีที่ให้ไป) — design.md §3
  if (pathname === '/login') return null;

  return (
    <nav
      aria-label="แท็บหลัก"
      className="fixed inset-x-0 bottom-0 z-20 mx-auto flex h-[calc(56px+env(safe-area-inset-bottom))] max-w-[430px] border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] shadow-[var(--shadow-sticky)]"
    >
      {TABS.map((tab) => {
        const active = tab.href === '/' ? pathname === '/' : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={`flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 text-[13px] leading-[18px] ${
              active ? 'font-semibold text-[var(--balance)]' : 'text-text-muted'
            }`}
          >
            <svg className="size-5" aria-hidden="true">
              <use href={`#${tab.icon}`} />
            </svg>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
