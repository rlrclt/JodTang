/**
 * ข้อมูลตัวอย่างสำหรับเฟส 1 (UI ล้วน ยังไม่ต่อ DB)
 *
 * ⚠ ลบทั้งไฟล์นี้เมื่อต่อ DB จริง (เฟส 2) — ตัวผู้เรียกคือ (S2) app/page.tsx · (S4) app/transactions/page.tsx ·
 *   (S5) app/summary/page.tsx · (S3) components/AddEntrySheet.tsx
 *   ตอนนั้นให้เปลี่ยนเป็น query ที่กรอง user_id = <session user> + deleted_at is null + kind in MONEY_KINDS
 *   (ดูคอมเมนต์หัวไฟล์ src/lib/money.ts) แล้วส่งผลลัพธ์เข้า periodTotals() เหมือนเดิม
 *
 * ตัวเลขชุดนี้เป็นชุดเดียวกับที่ตรวจไว้ใน docs/theme-preview.html (ยอดต้องตรงกันทุกหน้า):
 *   รับ 2,450,000 · จ่าย 1,284,000 · คงเหลือ 1,166,000 สตางค์ (หน่วยสตางค์ทั้งหมด ห้ามเป็นบาท)
 */
import type { MoneyRow } from '@/lib/money';

/** กระเป๋า/หมวดใช้ id คงที่ได้ เพราะยังไม่มี DB (ของจริงคือตาราง accounts/categories) */
export const ACCOUNT = { id: 'a1', name: 'เงินสด', initialBalance: 0 } as const;

export type Category = {
  id: string;
  name: string;
  kind: 'income' | 'expense';
  /** สีตามชุดกราฟ 8 สี ของ docs/design.md §1.1 (ห้ามใช้เฉดเขียวกับกราฟรายจ่าย) */
  color: `--chart-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`;
};

export const CATEGORIES: Category[] = [
  { id: 'c-rent', name: 'ค่าห้อง', kind: 'expense', color: '--chart-1' },
  { id: 'c-supplies', name: 'ของใช้', kind: 'expense', color: '--chart-2' },
  { id: 'c-utility', name: 'ค่าน้ำค่าไฟ', kind: 'expense', color: '--chart-3' },
  { id: 'c-salary', name: 'เงินเดือน', kind: 'income', color: '--chart-4' },
  { id: 'c-travel', name: 'เดินทาง', kind: 'expense', color: '--chart-5' },
  { id: 'c-food', name: 'อาหาร', kind: 'expense', color: '--chart-6' },
  { id: 'c-coffee', name: 'กาแฟ', kind: 'expense', color: '--chart-7' },
  { id: 'c-sales', name: 'ขายของ', kind: 'income', color: '--chart-4' },
];

const BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

/** หมวดของแถว (transfer ไม่มีหมวด → undefined ตาม schema) */
export function categoryOf(id: string | null | undefined): Category | undefined {
  return id ? BY_ID.get(id) : undefined;
}

export type FixtureTxn = MoneyRow & {
  /** id ของแถว — React ต้องใช้เป็น key (ของจริงคือ transactions.id uuid) */
  id: string;
  /** ป้ายวันที่สั้น ๆ ที่แสดงในแถว (ของจริง format จาก occurred_at ตาม timezone ผู้ใช้) */
  dateLabel: string;
};

export const MONTH_LABEL = 'กันยายน 2569';

/** เรียงใหม่ -> เก่า (ของจริงคือ order by occurred_at desc, id desc — keyset) */
export const TRANSACTIONS: FixtureTxn[] = [
  { id: 't1', kind: 'expense', amount: 18_500, accountId: ACCOUNT.id, toAccountId: null, categoryId: 'c-food', deletedAt: null, dateLabel: '13 ก.ย.' },
  { id: 't2', kind: 'income', amount: 2_250_000, accountId: ACCOUNT.id, toAccountId: null, categoryId: 'c-salary', deletedAt: null, dateLabel: '13 ก.ย.' },
  { id: 't3', kind: 'expense', amount: 32_000, accountId: ACCOUNT.id, toAccountId: null, categoryId: 'c-travel', deletedAt: null, dateLabel: '12 ก.ย.' },
  { id: 't4', kind: 'expense', amount: 910_000, accountId: ACCOUNT.id, toAccountId: null, categoryId: 'c-rent', deletedAt: null, dateLabel: '12 ก.ย.' },
  { id: 't5', kind: 'expense', amount: 124_000, accountId: ACCOUNT.id, toAccountId: null, categoryId: 'c-supplies', deletedAt: null, dateLabel: '11 ก.ย.' },
  { id: 't6', kind: 'expense', amount: 190_000, accountId: ACCOUNT.id, toAccountId: null, categoryId: 'c-utility', deletedAt: null, dateLabel: '11 ก.ย.' },
  { id: 't7', kind: 'income', amount: 200_000, accountId: ACCOUNT.id, toAccountId: null, categoryId: 'c-sales', deletedAt: null, dateLabel: '10 ก.ย.' },
  { id: 't8', kind: 'expense', amount: 9_500, accountId: ACCOUNT.id, toAccountId: null, categoryId: 'c-coffee', deletedAt: null, dateLabel: '10 ก.ย.' },
];

/** จำนวนแถวล่าสุดที่โชว์ในหน้าแรก (ของจริงคือ limit 20 ตาม docs/design.md §4 S2) */
export const RECENT_LIMIT = 6;

/** แนวโน้มรายจ่าย 6 เดือน (สตางค์) — เดือนสุดท้ายต้องเท่ากับยอดจ่ายของเดือนนี้ */
export const TREND: { month: string; amount: number }[] = [
  { month: 'เม.ย.', amount: 1_124_000 },
  { month: 'พ.ค.', amount: 986_000 },
  { month: 'มิ.ย.', amount: 1_345_000 },
  { month: 'ก.ค.', amount: 1_002_000 },
  { month: 'ส.ค.', amount: 1_230_000 },
  { month: 'ก.ย.', amount: 1_284_000 },
];

/** งบต่อหมวดของเดือนนี้ (สตางค์) — แถวที่ใช้ไป ≥ 80% ต้องขึ้น --warn + คำกำกับ (ไม่ใช้สีอย่างเดียว) */
export const BUDGETS: { categoryId: string; used: number; total: number }[] = [
  { categoryId: 'c-food', used: 18_500, total: 600_000 },
  { categoryId: 'c-rent', used: 910_000, total: 950_000 },
];

/** หมวดที่เสนอให้เลือกตอนเปิด sheet (ของจริงเดาจากประวัติ/เวลา — §4 S3) */
export const SUGGESTED_CATEGORY_ID = 'c-food';
