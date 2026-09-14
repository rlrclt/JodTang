import Link from 'next/link';

import { SignOutButton } from '@/components/AuthButtons';
import { LoadFailed } from '@/components/LoadFailed';
import { InstallApp } from '@/components/Pwa';
import { getDb } from '@/db';
import { getUserProfile, type UserProfile } from '@/db/queries/profile';
import { isNextControlFlow } from '@/lib/next-signals';
import { formatMonthLabelTh, periodMonthOfBkk } from '@/lib/month';
import { withMonth } from '@/lib/month-url';

import { EmailControl } from './EmailControl';
import { gateSession } from '@/lib/session';

// design.md §3 แท็บ 4 (ตั้งค่า) — บัญชี/ออกจากระบบ + งบประมาณ ทำงานจริงแล้ว ส่วนที่เหลือยังเป็นโครง
// ของจริงตาม §4 S6: หมวดหมู่ · กระเป๋าเงิน · ธีม
export default async function SettingsPage() {
  const gate = await gateSession();
  if (gate.unavailable) return <LoadFailed />;
  const { name, userId } = gate.user;

  /**
   * อีเมล/สถานะยืนยันอ่านจาก DB (ไม่ใช่จาก session) — session ไม่มี emailVerified
   * และอีเมลตัวแทนของ LINE ต้องไม่ถูกแสดงเป็นอีเมลจริง
   */
  let profile: UserProfile | null = null;
  try {
    profile = await getUserProfile(getDb(), userId);
  } catch (error) {
    if (isNextControlFlow(error)) throw error;
    console.error('[jodjai] อ่านโปรไฟล์อีเมลไม่สำเร็จ:', error);
  }

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
            <div className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{name}</span>
              {profile ? (
                // ส่งลง client เฉพาะอีเมลจริง — อีเมลตัวแทนต้องไม่หลุดไปกับ RSC payload/HTML (wave25 acceptance 1)
                <EmailControl
                  email={profile.usesPlaceholderEmail ? null : profile.email}
                  emailVerified={profile.emailVerified}
                  usesPlaceholderEmail={profile.usesPlaceholderEmail}
                />
              ) : (
                <span className="block truncate text-[13px] leading-[18px] text-text-muted">
                  อ่านข้อมูลอีเมลไม่ได้ตอนนี้
                </span>
              )}
            </div>
            <SignOutButton />
          </div>
        </div>
      </section>
      <ul className="overflow-hidden rounded-card border border-border bg-surface">
        {/* หมวดหมู่ + กระเป๋าเงิน — หน้าที่ทำงานจริงแล้ว (wave 9) */}
        <li className="border-b border-border">
          <Link href="/settings/categories" className="flex min-h-14 items-center justify-between gap-3 px-4">
            <span>หมวดหมู่</span>
            <span className="flex items-center gap-1 text-[13px] text-text-muted">
              เพิ่ม/แก้/เลิกใช้
              <svg className="size-4" aria-hidden="true">
                <use href="#i-chevron-right" />
              </svg>
            </span>
          </Link>
        </li>
        <li className="border-b border-border">
          <Link href="/settings/accounts" className="flex min-h-14 items-center justify-between gap-3 px-4">
            <span>กระเป๋าเงิน</span>
            <span className="flex items-center gap-1 text-[13px] text-text-muted">
              เพิ่ม/แก้/เลิกใช้
              <svg className="size-4" aria-hidden="true">
                <use href="#i-chevron-right" />
              </svg>
            </span>
          </Link>
        </li>
        {/* ตั้งงบต่อหมวด — หน้าที่ทำงานจริงแล้ว (ข้อเสนอ §2) */}
        <li className="border-b border-border">
          <Link
            href={withMonth('/settings/budgets', periodMonthOfBkk())}
            className="flex min-h-14 items-center justify-between gap-3 px-4"
          >
            <span>งบประมาณ</span>
            <span className="flex items-center gap-1 text-[13px] text-text-muted">
              ตั้งงบต่อหมวด
              <svg className="size-4" aria-hidden="true">
                <use href="#i-chevron-right" />
              </svg>
            </span>
          </Link>
        </li>
        {/* รายการที่ลบแล้ว — หน้าที่ทำงานจริงแล้ว (wave21): กู้คืนรายการที่กดลบพลาด */}
        <li className="border-b border-border">
          <Link href="/settings/trash" className="flex min-h-14 items-center justify-between gap-3 px-4">
            <span>รายการที่ลบแล้ว</span>
            <span className="flex items-center gap-1 text-[13px] text-text-muted">
              กู้คืนรายการที่ลบ
              <svg className="size-4" aria-hidden="true">
                <use href="#i-chevron-right" />
              </svg>
            </span>
          </Link>
        </li>
        {/* ธีม: ไม่มีแถว "เร็ว ๆ นี้" ค้างในลิสต์ (wave18 sweep) — แอปยังไม่มีตัวสลับธีมใน UI
            ตัวจริงตามระบบทำงานอยู่ (THEME_SCRIPT ใน layout) และบอกความจริงไว้ท้ายหน้าแทนปุ่มที่กดไม่ได้ */}
      </ul>
      <section className="rounded-card border border-border bg-surface p-4">
        <h2 className="mb-2 font-semibold">ติดตั้งแอป</h2>
        <InstallApp />
      </section>

      <p className="text-[13px] leading-[18px] text-text-muted">
        เดือนปัจจุบัน: {formatMonthLabelTh(periodMonthOfBkk())} · ธีมตามระบบของอุปกรณ์ (ตัวสลับเองในแอปยังไม่ทำในเวอร์ชันนี้)
      </p>
    </div>
  );
}
