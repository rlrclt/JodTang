import Link from 'next/link';

import { formatMonthLabelTh, periodMonthOfBkk, shiftPeriodMonth } from '@/lib/month';
import { type MonthScope, withMonth } from '@/lib/month-url';

/**
 * แถบช่วงเวลาที่กำลังดู (spec §1 · wave19)
 *
 * - **โหมดเดือน**: ‹ [ชื่อเดือน] › + ชิป "ทุกเดือน" (เฉพาะหน้าที่อนุญาต — `/transactions`)
 *   ลูกศรเป็น <Link> ล้วน ไม่มี JS: URL เป็น state เดียว · ปุ่มสูง 44px (§2) · rel=prev/next ให้ crawler/AT เข้าใจ
 * - **โหมดทุกเดือน**: ไม่มีลูกศร (เดือนไม่มี prev/next) · ป้ายกลาง = "ทุกเดือน" + ทางกลับ "กลับไปเดือนนี้"
 *
 * `basePath` = เส้นทาง (+ query ที่ต้องคงไว้ เช่นตัวกรอง) **โดยไม่ต้องมี `m`** — component เป็นคนเติม m ให้
 * แถวเป็น flex-wrap: ที่ 320px ชิป "ทุกเดือน" ตกบรรทัดสองได้ (ยอมรับ — §2)
 */
export function MonthSwitcher({
  basePath,
  scope,
  canSwitchToAll = false,
}: {
  basePath: string;
  scope: MonthScope;
  /** แสดงชิป "ทุกเดือน" ไหม — เปิดเฉพาะ /transactions (หน้า / และ /summary เป็นของเดือนเดียวเสมอ) */
  canSwitchToAll?: boolean;
}) {
  if (scope === 'all') {
    return (
      <nav aria-label="ช่วงเวลาที่แสดง" className="flex min-h-11 flex-wrap items-center gap-2">
        <p className="text-xl font-semibold">ทุกเดือน</p>
        <Link
          href={withMonth(basePath, periodMonthOfBkk())}
          className="ml-auto flex min-h-11 items-center rounded-btn border border-border-strong px-3 text-[13px] font-semibold"
        >
          กลับไปเดือนนี้
        </Link>
      </nav>
    );
  }

  return (
    <nav aria-label="ช่วงเวลาที่แสดง" className="flex min-h-11 flex-wrap items-center justify-between gap-2">
      <Link
        href={withMonth(basePath, shiftPeriodMonth(scope, -1))}
        rel="prev"
        aria-label="เดือนก่อนหน้า"
        className="flex size-11 items-center justify-center rounded-input text-text-muted"
      >
        ‹
      </Link>
      <p className="text-xl font-semibold">{formatMonthLabelTh(scope)}</p>
      <Link
        href={withMonth(basePath, shiftPeriodMonth(scope, 1))}
        rel="next"
        aria-label="เดือนถัดไป"
        className="flex size-11 items-center justify-center rounded-input text-text-muted"
      >
        ›
      </Link>
      {canSwitchToAll ? (
        <Link
          href={withMonth(basePath, 'all')}
          role="button"
          aria-pressed={false}
          className="flex min-h-11 items-center rounded-btn border border-border px-3 text-[13px] font-semibold"
        >
          ทุกเดือน
        </Link>
      ) : null}
    </nav>
  );
}
