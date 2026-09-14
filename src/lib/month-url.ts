import { periodMonthFromParam, type PeriodMonth } from './month.ts';

/**
 * งวดเดือนบน URL — `?m=YYYY-MM-01` คือ "state เดียว" ของเดือนทั้งแอป (spec §1)
 * ไม่มี cookie/localStorage: ติดค่าต่อไปตามลิงก์เท่านั้น เพื่อให้แชร์ URL ได้และ Back ทำงานถูก
 */

/**
 * ช่วงเวลาที่หน้ารายการดูอยู่ (wave19): เดือนหนึ่ง ๆ หรือ **ทุกเดือน** (`?m=all`)
 * ใช้กับ `/transactions` เท่านั้น — หน้าอื่นต้องมีเดือนจริงเสมอ (การ์ดยอด/กราฟ/เทียบงบเป็น "ของเดือน")
 */
export type MonthScope = PeriodMonth | 'all';

/**
 * อ่าน `?m` ที่เป็นได้ทั้งเดือนและ 'all' — **ไม่ยุบ 'all' เป็นเดือนปัจจุบัน** (ต่างจาก periodMonthFromParam)
 * ค่าขยะอื่น ('', 'm=al', '2026-13-01') ยังตกกลับเดือนปัจจุบันตามกติกาเดิม → หน้าเว็บตอบ 200 ไม่ 500
 */
export function monthScopeFromParam(value: unknown): MonthScope {
  return value === 'all' ? 'all' : periodMonthFromParam(value);
}

/**
 * สร้าง href ที่มี `m` ของช่วงเวลานั้น (เดือน หรือ 'all') โดยคง query เดิมไว้ (kind/categoryId/accountId/q)
 * `extra` ใช้เติมค่าที่หน้าอยากส่งต่อ เช่น { pages: '2' } ของปุ่ม "โหลดเพิ่ม"
 *
 * หมายเหตุ: ตัว `m` ถูกเขียนทับเสมอ — ถ้า href เดิมมี `pages` ติดมา caller ต้องไม่ส่งมันมาใน base
 * (ทุกหน้าที่ใช้ helper นี้สร้าง base จากตัวกรองปัจจุบันโดยไม่รวม `pages` — ดู src/app/transactions/page.tsx)
 * และการ "ล้างตัวกรอง" ต้องคงขอบเขตเวลาเดิมไว้: ส่ง scope เดิมกลับเข้ามา ('all' = ล้างค่าไม่ใช่ล้างช่วง)
 */
export function withMonth(
  href: string,
  scope: MonthScope,
  extra: Record<string, string | number | undefined> = {},
): string {
  const [path, search = ''] = href.split('?');
  const params = new URLSearchParams(search);
  params.set('m', scope);
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) params.delete(key);
    else params.set(key, String(value));
  }
  return `${path}?${params.toString()}`;
}
