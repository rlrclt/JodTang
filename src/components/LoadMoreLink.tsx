'use client';

import Link from 'next/link';
import { useLinkStatus } from 'next/link';

/**
 * ปุ่ม "โหลดเพิ่ม" ของหน้ารายการ (spec §3) — ยังเป็น `<Link>` ธรรมดา (Back/แชร์ URL ได้ ไม่มี client state)
 * แต่มีสถานะกำลังโหลด: `useLinkStatus()` ต้องเรียกจาก **ลูกของ `<Link>`** จึงแยกเป็น component ย่อย
 * ระหว่าง pending: ข้อความเปลี่ยน + กันการกดซ้ำ (preventDefault ที่ตัวข้อความ ซึ่ง bubbled ไปถึง onClick ของ Link)
 */
export function LoadMoreLink({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="flex min-h-14 items-center justify-center rounded-card border border-border-strong bg-surface font-semibold"
    >
      <LoadMoreLabel />
    </Link>
  );
}

function LoadMoreLabel() {
  const { pending } = useLinkStatus();

  return (
    <span
      aria-live="polite"
      onClick={pending ? (event) => event.preventDefault() : undefined}
      className={pending ? 'opacity-60' : undefined}
    >
      {pending ? 'กำลังโหลด…' : 'โหลดเพิ่ม'}
    </span>
  );
}
