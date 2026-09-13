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
 * ช่วงปีที่ระบบรองรับ — ต้องเป็นปี 4 หลักเสมอ
 * '0000-01-01' หรือปีที่เลื่อนจนเกิน 9999 จะประกอบเป็นสตริงผิดรูป ('00-1-…' / '10000-01-01')
 * แล้ว PG จะปฏิเสธ date param → หน้าจอพัง 500 (รีวิว wave7b ข้อ 1)
 */
const MIN_PERIOD_YEAR = 1000;
const MAX_PERIOD_YEAR = 9999;

/** อ่าน 'YYYY-MM-01' → ปี/เดือน (ค.ศ.) · ผิดรูป/ปีนอกช่วง = TypeError เพราะงวดเดือนของทั้งแอปมีรูปแบบเดียว */
function parsePeriodMonth(periodMonth: PeriodMonth): { year: number; month: number } {
  const match = /^(\d{4})-(\d{2})-01$/.exec(String(periodMonth));
  const month = match ? Number(match[2]) : 0;
  const year = match ? Number(match[1]) : 0;
  if (!match || month < 1 || month > 12 || year < MIN_PERIOD_YEAR || year > MAX_PERIOD_YEAR) {
    throw new TypeError(`periodMonth ต้องเป็น 'YYYY-MM-01' (ได้ ${JSON.stringify(periodMonth)})`);
  }
  return { year, month };
}

/**
 * เลื่อนงวดเดือนไป N เดือน (บวก = อนาคต, ลบ = อดีต) — '2026-01-01' − 1 เดือน = '2025-12-01'
 * คิดจากสตริงล้วน ไม่ใช้ Date เลย → ไม่ขึ้นกับ timezone ของเครื่องและไม่มีปัญหา DST/วันที่ 31
 * เลื่อนจนสุดขอบช่วงปี = **หยุดที่ขอบ** (ไม่คืนสตริงผิดรูป) → ปุ่ม ‹ › ของ UI ไม่ทำให้หน้าพัง
 */
export function shiftPeriodMonth(periodMonth: PeriodMonth, months: number): PeriodMonth {
  const { year, month } = parsePeriodMonth(periodMonth);
  if (!Number.isSafeInteger(months)) {
    throw new TypeError(`months ต้องเป็นจำนวนเต็ม (ได้ ${String(months)})`);
  }
  const total = year * 12 + (month - 1) + months;
  const shiftedYear = Math.floor(total / 12);
  if (shiftedYear < MIN_PERIOD_YEAR) return `${MIN_PERIOD_YEAR}-01-01`;
  if (shiftedYear > MAX_PERIOD_YEAR) return `${MAX_PERIOD_YEAR}-12-01`;

  const shiftedMonth = (total % 12) + 1; // total ติดลบก็ยังถูก เพราะ % คงเครื่องหมายของตัวตั้ง
  return `${String(shiftedYear).padStart(4, '0')}-${String(shiftedMonth).padStart(2, '0')}-01`;
}

/**
 * อ่านงวดเดือนจาก **ค่าดิบที่ผู้ใช้คุม** (query param `?m=` ของหน้าเว็บ) — **ไม่ throw เด็ดขาด**
 * ค่าที่ผิดรูป ('' · 'abc' · '2026-13-01' · '2026-09-15' · null · array) → คืน **เดือนปัจจุบัน** เพื่อให้หน้าเว็บตอบ 200
 * เหตุผล: ถ้าปล่อยให้ค่าจาก URL ไปถึง parsePeriodMonth() ตรง ๆ ผู้ใช้พิมพ์ ?m=abc ก็ได้ 500 (spec §1 ห้าม)
 */
export function periodMonthFromParam(value: unknown): PeriodMonth {
  if (typeof value !== 'string') return periodMonthOfBkk();

  const match = /^(\d{4})-(\d{2})-01$/.exec(value);
  const month = match ? Number(match[2]) : 0;
  const year = match ? Number(match[1]) : 0;
  if (!match || month < 1 || month > 12 || year < MIN_PERIOD_YEAR || year > MAX_PERIOD_YEAR) {
    return periodMonthOfBkk();
  }

  return value;
}

/**
 * ป้ายเดือนไทยสำหรับแสดงผล: '2026-09-01' → 'กันยายน 2569' (ปีพุทธศักราช — ตรงกับ MONTH_LABEL ที่ UI ใช้)
 * รับเฉพาะวันแรกของเดือน เพราะงวดเดือนของทั้งแอปคือ 'YYYY-MM-01' (วันที่อื่น = ผู้เรียกเข้าใจผิด → ล้มเสียงดัง)
 */
export function formatMonthLabelTh(periodMonth: PeriodMonth): string {
  const { year, month } = parsePeriodMonth(periodMonth);
  return `${TH_MONTHS[month - 1]} ${year + 543}`;
}
