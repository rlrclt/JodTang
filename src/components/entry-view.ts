/**
 * ตรรกะบริสุทธิ์ของชีต "เพิ่มรายการ" (wave 10b) — ทดสอบด้วย `node --test` ได้ ไม่มี DOM/React
 * ที่นี่คือที่เดียวที่ตัดสิน "กระเป๋า/หมวดเริ่มต้นคืออะไร" และ "กดบันทึกได้ไหม เพราะอะไร"
 */

export type EntryKind = 'income' | 'expense' | 'transfer';

export type EntryAccount = { id: string; name: string };
export type EntryCategory = { id: string; name: string; color: string | null };

export type EntryOptions = {
  accounts: EntryAccount[];
  categories: { income: EntryCategory[]; expense: EntryCategory[] };
  /** กระเป๋าที่ใช้ล่าสุด (ข้ามใบที่ archive แล้ว) — null = ยังไม่เคยใช้ */
  lastUsedAccountId: string | null;
  /** หมวดของรายการล่าสุดของ kind นั้น — null = ยังไม่มีข้อมูลให้เดา */
  suggested: { income: string | null; expense: string | null };
};

export const ENTRY_KIND_LABELS: Record<EntryKind, string> = {
  income: 'รับ',
  expense: 'จ่าย',
  transfer: 'โอน',
};

/** ชื่อหมวดที่เสนอให้สร้าง 1 แตะ เมื่อผู้ใช้ยังไม่มีหมวดของ kind นั้นเลย (เรียงตามที่ใช้บ่อย) */
export const SUGGESTED_CATEGORY_NAMES: Record<'income' | 'expense', readonly string[]> = {
  expense: ['อาหาร', 'เดินทาง', 'ของใช้'],
  income: ['เงินเดือน', 'ขายของ'],
};

/**
 * สีตั้งต้นของแต่ละชื่อหมวด (design.md §1.1) — expense ห้ามเฉดเขียว เด็ดขาด
 * `--chart-4`/`--chart-7` จึงให้ได้เฉพาะฝั่ง income (เงินเดือน/ขายของ)
 * ชื่อทั้งหมดต้องมาจาก SUGGESTED_CATEGORY_NAMES ชุดเดิมเท่านั้น (ห้ามคิดรายชื่อชุดที่สอง) — มีเทสต์กันไว้
 */
const SETUP_COLORS: Record<string, string> = {
  อาหาร: '--chart-1',
  เดินทาง: '--chart-2',
  ของใช้: '--chart-3',
  เงินเดือน: '--chart-4',
  ขายของ: '--chart-7',
};

/** แผน "เริ่มใช้งานเร็ว": 5 หมวด (ชื่อจาก SUGGESTED_CATEGORY_NAMES) + สีตามกติกา §1.1 */
export const SETUP_CATEGORIES: readonly { kind: 'expense' | 'income'; name: string; color: string | null }[] = [
  ...SUGGESTED_CATEGORY_NAMES.expense.map((name) => ({ kind: 'expense' as const, name, color: SETUP_COLORS[name] ?? null })),
  ...SUGGESTED_CATEGORY_NAMES.income.map((name) => ({ kind: 'income' as const, name, color: SETUP_COLORS[name] ?? null })),
];

/**
 * กระเป๋าเริ่มต้น: ใบที่ใช้ล่าสุด → ใบแรกตาม createdAt
 * (ค่า lastUsed ที่ชี้ไปใบที่ archive/หายไปแล้ว = ใช้ไม่ได้ ต้องตกไปใบแรก — กันเลือกกระเป๋าที่ไม่มีในลิสต์)
 */
export function defaultAccountId(options: EntryOptions): string | null {
  const { accounts, lastUsedAccountId } = options;
  if (accounts.length === 0) return null;
  if (lastUsedAccountId && accounts.some((account) => account.id === lastUsedAccountId)) return lastUsedAccountId;
  return accounts[0].id;
}

/**
 * หมวดเริ่มต้นของ kind: ที่เดาจากรายการล่าสุด → หมวดแรกของ kind นั้น
 * **ต้องเป็นหมวดของ kind ที่เลือกเสมอ** — สลับ รับ/จ่าย แล้วต้องได้หมวดของ kind ใหม่ ไม่ค้างของเดิม (acceptance 3)
 */
export function defaultCategoryId(options: EntryOptions, kind: 'income' | 'expense'): string | null {
  const list = options.categories[kind];
  const suggested = options.suggested[kind];
  if (suggested && list.some((category) => category.id === suggested)) return suggested;
  return list[0]?.id ?? null;
}

export type EntryDraft = {
  kind: EntryKind;
  /** สตางค์จากช่องกรอก (null = ยังไม่กรอก) */
  amountSatang: number | null;
  accountId: string | null;
  toAccountId: string | null;
  categoryId: string | null;
  accountCount: number;
};

/**
 * เหตุผลที่ "บันทึกไม่ได้" (null = บันทึกได้) — ข้อความเดียวที่ UI ใช้ทั้งปิดปุ่มและบอกผู้ใช้
 * กติกา: ต้องมีกระเป๋าเสมอ (mutation บังคับ) · โอนต้องมี ≥2 ใบและปลายทางต่างจากต้นทาง · รับ/จ่ายต้องมีหมวด
 */
export function entryBlockReason(draft: EntryDraft): string | null {
  if (draft.accountCount === 0) return 'ยังไม่มีกระเป๋า — กด "สร้างกระเป๋า เงินสด" ก่อนจึงบันทึกได้';

  if (draft.kind === 'transfer') {
    if (draft.accountCount < 2) return 'โอนต้องมีอย่างน้อย 2 กระเป๋า';
    if (!draft.toAccountId) return 'เลือกกระเป๋าปลายทางก่อน';
    if (draft.toAccountId === draft.accountId) return 'ปลายทางต้องไม่ใช่กระเป๋าเดียวกัน';
    return null;
  }

  if (!draft.categoryId) return 'เลือกหมวดก่อนบันทึก';
  return null;
}

/** โอนได้เฉพาะเมื่อมีกระเป๋าให้เลือกปลายทางอย่างน้อย 1 ใบที่ไม่ใช่ใบต้นทาง */
export function canTransferWith(accountCount: number): boolean {
  return accountCount >= 2;
}

/**
 * วันที่ของชีต (wave17) — ค่าที่ <input type="date"> ใช้: 'YYYY-MM-DD' ตาม **ปฏิทินไทย**
 * ที่นี่คือที่เดียวที่แปลง Date ⇄ วันที่ไทยของชีต (เหตุผลเดียวกับ src/lib/month.ts: เครื่องรันไม่ใช่ไทย)
 */
export type DateInputValue = string;

const BKK_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** วันที่ไทย (YYYY-MM-DD) ของเวลาใด ๆ — ใช้ formatToParts ไม่พึ่ง locale ว่าเรียงปี-เดือน-วัน */
export function bangkokDateValue(at: Date): DateInputValue {
  const parts = BKK_DATE.formatToParts(at);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * 'YYYY-MM-DD' → Date ที่ **เที่ยงวันไทย** (+07:00)
 * เที่ยงวันเพื่อไม่ให้เวลา/โซนของเครื่องเลื่อนวันที่ไปข้างหน้าหรือย้อนหลัง (ไทยไม่มี DST จึง +07 คงที่)
 * คืน null เมื่อรูปไม่ถูกหรือวันที่ไม่มีจริง (เช่น 2026-02-31 ซึ่ง JS จะเลื่อนเป็น 3 มี.ค. เงียบ ๆ)
 */
export function bangkokDateFromValue(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const at = new Date(`${value}T12:00:00+07:00`);
  if (Number.isNaN(at.getTime())) return null;
  return bangkokDateValue(at) === value ? at : null;
}

/** ปุ่มลัด "วันนี้" ตามเวลาไทย (design.md §2) */
export function bangkokTodayValue(now: Date = new Date()): DateInputValue {
  return bangkokDateValue(now);
}

/** ปุ่มลัด "เมื่อวาน" — ลบ 24 ชม.จาก "ตอนนี้" แล้วอ่านวันที่ไทย (ข้ามเดือน/ข้ามวันถูกต้อง) */
export function bangkokYesterdayValue(now: Date = new Date()): DateInputValue {
  return bangkokDateValue(new Date(now.getTime() - 86_400_000));
}
