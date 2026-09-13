/**
 * การคิด "เดือน" ของทั้งแอป — ที่เดียว (กติกา docs/schema.sql ข้อ 6: ตัดเดือน/ปีต้องใช้เวลาไทย ไม่ใช่ UTC)
 *
 * ทำไมต้องมีไฟล์นี้: ถ้าปล่อยให้แต่ละหน้าเรียก getMonth()/toISOString() เอง แต่ละที่จะเพี้ยนคนละแบบ
 *   - `toISOString().slice(0,7)` = ตัดเดือนตาม UTC → รายการคืนวันที่ 31 ที่บันทึก 23:30 น. ไทย ไปโผล่เดือนถัดไป
 *   - `new Date().getMonth()` = เดือนของ timezone เครื่องที่รัน (เครื่อง dev เป็นอะไรก็ได้ ไม่ใช่ไทย)
 * ไทยไม่มี DST → +07 ตลอดปี และคอลัมน์ `transactions.occurred_month_bkk` ฝั่ง DB ก็ตรึง +07 ไว้แล้ว
 *   งวดเดือนที่ได้จากไฟล์นี้จึงเทียบ equality กับคอลัมน์นั้นได้ตรง ๆ
 *
 * ไฟล์นี้ไม่ import อะไรเลยโดยตั้งใจ (แบบเดียวกับ src/lib/money.ts) เพื่อให้เทสต์รันด้วย `node --test` ได้ตรง ๆ
 */

/** 'YYYY-MM-01' ของเดือนไทย (Asia/Bangkok) — งวดเดือนเดียวกับ `transactions.occurred_month_bkk` */
export type PeriodMonth = string;

const BKK = 'Asia/Bangkok';

/** en-CA ให้รูปแบบ 'YYYY-MM-DD' ตรง ๆ (ไม่ต้องประกอบสตริงจาก getFullYear/getMonth ซึ่งเป็นเวลาเครื่อง) */
const BKK_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: BKK,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** งวดเดือนไทยของ "ตอนนี้" (หรือเวลาที่ส่งเข้ามา) — วันแรกของเดือนเสมอ เพื่อเทียบ equality กับ occurred_month_bkk */
export function periodMonthOfBkk(now: Date = new Date()): PeriodMonth {
  return `${BKK_DATE.format(now).slice(0, 7)}-01`;
}

const TH_MONTHS = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
] as const;

/**
 * ป้ายเดือนไทยสำหรับแสดงผล: '2026-09-01' → 'กันยายน 2569' (ปีพุทธศักราช — ตรงกับ MONTH_LABEL ที่ UI ใช้)
 * รับเฉพาะวันแรกของเดือน เพราะงวดเดือนของทั้งแอปคือ 'YYYY-MM-01' (วันที่อื่น = ผู้เรียกเข้าใจผิด → ล้มเสียงดัง)
 */
export function formatMonthLabelTh(periodMonth: PeriodMonth): string {
  const match = /^(\d{4})-(\d{2})-01$/.exec(String(periodMonth));
  const month = match ? Number(match[2]) : 0;
  if (!match || month < 1 || month > 12) {
    throw new TypeError(`periodMonth ต้องเป็น 'YYYY-MM-01' (ได้ ${JSON.stringify(periodMonth)})`);
  }
  return `${TH_MONTHS[month - 1]} ${Number(match[1]) + 543}`;
}
