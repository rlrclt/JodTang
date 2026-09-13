import Link from 'next/link';

import { SignOutButton } from '@/components/AuthButtons';
import { LoadFailed } from '@/components/LoadFailed';
import { InstallApp } from '@/components/Pwa';
import { formatMonthLabelTh, periodMonthOfBkk } from '@/lib/month';
import { gateSession } from '@/lib/session';

// design.md §3 แท็บ 4 (ตั้งค่า) — บัญชี/ออกจากระบบ + งบประมาณ ทำงานจริงแล้ว ส่วนที่เหลือยังเป็นโครง
// ของจริงตาม §4 S6: หมวดหมู่ · กระเป๋าเงิน · ธีม
export default async function SettingsPage() {
  const gate = await gateSession();
  if (gate.unavailable) return <LoadFailed />;
  const { name, email } = gate.user;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">ตั้งค่า</h1>

      {/* ใครล็อกอินอยู่ + ออกจากระบบ (design.md §4 S6) — แถวแบบเดียวกับลิสต์ด้านล่าง */}
      <section aria-labelledby="account-label" className="flex flex-col gap-2">
        <h2 id="account-label" className="text-xl font-semibold">
          บัญชี
        </h2>
        <div className="rounded-card border border-border bg-surface px-4">
          <div className="flex min-h-14 flex-wrap items-center justify-between gap-3">
            <span className="min-w-0">
              <span className="block truncate font-semibold">{name}</span>
              <span className="block truncate text-[13px] leading-[18px] text-text-muted">
                {email ?? 'บัญชีนี้ไม่มีอีเมล (LINE ยังไม่อนุมัติสิทธิ์อีเมล)'}
              </span>
            </span>
            <SignOutButton />
          </div>
        </div>
      </section>
      <ul className="overflow-hidden rounded-card border border-border bg-surface">
        <li className="border-b border-border px-4">
          <div className="flex min-h-14 items-center justify-between gap-3">
            <span>หมวดหมู่</span>
            <span className="text-[13px] text-text-muted">เร็ว ๆ นี้</span>
          </div>
        </li>
        <li className="border-b border-border px-4">
          <div className="flex min-h-14 items-center justify-between gap-3">
            <span>กระเป๋าเงิน</span>
            <span className="text-[13px] text-text-muted">เร็ว ๆ นี้</span>
          </div>
        </li>
        {/* ตั้งงบต่อหมวด — หน้าที่ทำงานจริงแล้ว (ข้อเสนอ §2) */}
        <li className="border-b border-border">
          <Link href="/settings/budgets" className="flex min-h-14 items-center justify-between gap-3 px-4">
            <span>งบประมาณ</span>
            <span className="flex items-center gap-1 text-[13px] text-text-muted">
              ตั้งงบต่อหมวด
              <svg className="size-4" aria-hidden="true">
                <use href="#i-chevron-right" />
              </svg>
            </span>
          </Link>
        </li>
        <li className="px-4">
          <div className="flex min-h-14 items-center justify-between gap-3">
            <span>ธีม</span>
            <span className="text-[13px] text-text-muted">เร็ว ๆ นี้</span>
          </div>
        </li>
      </ul>
      <section className="rounded-card border border-border bg-surface p-4">
        <h2 className="mb-2 font-semibold">ติดตั้งแอป</h2>
        <InstallApp />
      </section>

      <p className="text-[13px] leading-[18px] text-text-muted">
        เดือนปัจจุบัน: {formatMonthLabelTh(periodMonthOfBkk())} · ธีมตามระบบอยู่แล้ว (สลับเองได้ในหน้านี้ตอนต่อ DB)
      </p>
    </div>
  );
}
