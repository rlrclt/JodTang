import Link from 'next/link';

import { type PeriodMonth, formatMonthLabelTh, shiftPeriodMonth } from '@/lib/month';
import { withMonth } from '@/lib/month-url';

/**
 * แถบสลับเดือน ‹ [ชื่อเดือน] › (spec §1) — ทั้งสองลูกศรเป็น <Link> ล้วน
 * ไม่มี JS: URL เป็น state เดียว · ปุ่มสูง 44px (§2) · เชื่อมด้วย rel=prev/next เพื่อให้ crawler/AT เข้าใจ
 *
 * `basePath` = เส้นทาง (+ query ที่ต้องคงไว้ เช่นตัวกรอง) **โดยไม่ต้องมี `m`** — component เป็นคนเติม m ให้
 */
export function MonthSwitcher({ basePath, periodMonth }: { basePath: string; periodMonth: PeriodMonth }) {
  return (
    <nav aria-label="สลับเดือน" className="flex min-h-11 items-center justify-between gap-2">
      <Link
        href={withMonth(basePath, shiftPeriodMonth(periodMonth, -1))}
        rel="prev"
        aria-label="เดือนก่อนหน้า"
        className="flex size-11 items-center justify-center rounded-input text-text-muted"
      >
        ‹
      </Link>
      <p className="text-xl font-semibold">{formatMonthLabelTh(periodMonth)}</p>
      <Link
        href={withMonth(basePath, shiftPeriodMonth(periodMonth, 1))}
        rel="next"
        aria-label="เดือนถัดไป"
        className="flex size-11 items-center justify-center rounded-input text-text-muted"
      >
        ›
      </Link>
    </nav>
  );
}
