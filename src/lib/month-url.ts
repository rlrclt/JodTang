import type { PeriodMonth } from '@/lib/month';

/**
 * งวดเดือนบน URL — `?m=YYYY-MM-01` คือ "state เดียว" ของเดือนทั้งแอป (spec §1)
 * ไม่มี cookie/localStorage: ติดค่าต่อไปตามลิงก์เท่านั้น เพื่อให้แชร์ URL ได้และ Back ทำงานถูก
 */

/**
 * สร้าง href ที่มี `m` ของเดือนนั้น โดยคง query เดิมไว้ (kind/categoryId/accountId/q)
 * `extra` ใช้เติมค่าที่หน้าอยากส่งต่อ เช่น { pages: '2' } ของปุ่ม "โหลดเพิ่ม"
 *
 * หมายเหตุ: ตัว `m` ถูกเขียนทับเสมอ — ถ้า href เดิมมี `pages` ติดมา caller ต้องไม่ส่งมันมาใน base
 * (ทุกหน้าที่ใช้ helper นี้สร้าง base จากตัวกรองปัจจุบันโดยไม่รวม `pages` — ดู src/app/transactions/page.tsx)
 */
export function withMonth(
  href: string,
  periodMonth: PeriodMonth,
  extra: Record<string, string | number | undefined> = {},
): string {
  const [path, search = ''] = href.split('?');
  const params = new URLSearchParams(search);
  params.set('m', periodMonth);
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) params.delete(key);
    else params.set(key, String(value));
  }
  return `${path}?${params.toString()}`;
}
