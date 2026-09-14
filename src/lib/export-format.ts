/**
 * รูปแบบไฟล์ส่งออกของผู้ใช้ — **pure function ล้วน** (ไม่แตะ DB/request/Next) จึงทดสอบด้วย `node --test` ตรง ๆ
 *
 * สองไฟล์ตามสเปก local://wave27-design.md:
 *   1. CSV รายการ (อ่านในชีต): BOM + comma + CRLF + quote ตาม RFC 4180 · มีทั้งสตางค์ (จำนวนเต็ม) และบาท (ทศนิยม 2 ตำแหน่ง)
 *   2. JSON สำรองข้อมูล: compact · จำนวนเงินเป็น "สตางค์จำนวนเต็มเท่านั้น" (ไม่มีการหาร 100 ที่ไหนในไฟล์สำรอง)
 *
 * กติกาที่ห้ามพลาด:
 *   - เงินทุกตัวผ่าน `toSatang()` (ด่านเดียวของจำนวนเงินใน src/lib/money.ts) → ค่าที่ไม่ใช่จำนวนเต็ม "ล้มเสียงดัง"
 *     ไม่ปล่อยให้ไฟล์เพี้ยนเงียบ ๆ
 *   - เวลาใน CSV เป็น ISO-8601 พร้อม offset ไทย (`2026-09-13T14:05:00+07:00`) — offset คำนวณจาก Intl ไม่ hardcode
 *   - ฟิลด์ที่มี comma/เครื่องหมายคำพูด/ขึ้นบรรทัดใหม่/**ช่องว่างหัวท้าย** ต้องครอบด้วย " และซ้ำ " เป็น ""
 *     (ช่องว่างหัวท้ายสำคัญ: `note` ที่ผู้ใช้เคาะ space หน้า/หลังต้องไม่หายไปเงียบ ๆ)
 */
import { toSatang } from './money.ts';

/** แถวรายการที่ส่งออก (denormalize ชื่อกระเป๋า/ปลายทาง/หมวดมาแล้ว — ผู้ใช้อ่านไฟล์ได้โดยไม่ต้องเปิด lookup) */
export type ExportRow = {
  id: string;
  /** เวลาที่เกิดรายการ (timestamptz) */
  occurredAt: Date;
  /** งวดเดือนไทยจากคอลัมน์ generate ของ DB — 'YYYY-MM-01' */
  occurredMonth: string;
  /** 'income' | 'expense' | 'transfer' (การันตีโดย check constraint) */
  kind: string;
  /** สตางค์จำนวนเต็ม (บวกเสมอ — ทิศทางมาจาก kind) */
  amount: number;
  currency: string;
  accountName: string;
  /** ชื่อกระเป๋าปลายทาง (เฉพาะโอน) */
  toAccountName: string | null;
  categoryName: string | null;
  note: string | null;
  createdAt: Date;
};

/** กระเป๋าในไฟล์สำรอง — มี `archivedAt` (คอลัมน์สถานะ) เพราะรายการเก่าอ้างถึงกระเป๋าที่เลิกใช้แล้ว */
export type BackupAccount = {
  id: string;
  name: string;
  kind: string;
  currency: string;
  /** สตางค์จำนวนเต็ม (ติดลบได้ = ยอดค้างบัตรเครดิต) */
  initialBalance: number;
  icon: string | null;
  color: string | null;
  archivedAt: Date | null;
  createdAt: Date;
};

/** หมวดในไฟล์สำรอง — รวมหมวดที่ archive แล้ว (พร้อมสถานะ) ด้วยเหตุผลเดียวกับกระเป๋า */
export type BackupCategory = {
  id: string;
  kind: string;
  name: string;
  icon: string | null;
  color: string | null;
  sortOrder: number;
  archivedAt: Date | null;
  createdAt: Date;
};

/** งบในไฟล์สำรอง — งบเป็น "แผนต่อเดือน" จึงไม่อยู่ใน CSV แต่ต้องสำรองไว้ */
export type BackupBudget = {
  id: string;
  categoryId: string;
  /** 'YYYY-MM-01' ของเดือนไทย */
  periodMonth: string;
  /** สตางค์จำนวนเต็ม */
  amount: number;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
};

/** ตัวเลขสรุปในไฟล์สำรอง — `excludedDeleted` = จำนวนรายการที่ลบแล้วและ "ไม่ถูกส่งออก" (ความโปร่งใสตามสเปก §1) */
export type BackupCounts = {
  accounts: number;
  categories: number;
  budgets: number;
  transactions: number;
  excludedDeleted: number;
};

export type BackupData = {
  /** ISO-8601 (UTC) ของเวลาที่สร้างไฟล์ */
  exportedAt: string;
  counts: BackupCounts;
  accounts: BackupAccount[];
  categories: BackupCategory[];
  budgets: BackupBudget[];
  transactions: ExportRow[];
};

/** หัวคอลัมน์ CSV — ลำดับตามสเปก §2 (ต้องตรงเป๊ะ: ผู้ใช้ที่ทำสูตรในชีตจะพังถ้าลำดับเปลี่ยน) */
export const CSV_HEADERS = [
  'id',
  'occurred_at',
  'occurred_month',
  'kind',
  'amount_satang',
  'amount_thb',
  'currency',
  'account_name',
  'to_account_name',
  'category_name',
  'note',
  'created_at',
] as const;

const BOM = '\uFEFF';
const CRLF = '\r\n';

/**
 * offset ของไทยตอนนี้ (เช่น '+07:00') — อ่านจาก Intl ไม่ hardcode '+07:00'
 * เผื่ออนาคตที่ offset เปลี่ยน (ข้อมูลเก่า/ใหม่จะยังเขียนถูก) — ไทยไม่มี DST อยู่แล้วจึงคงที่ในทางปฏิบัติ
 */
const BKK_OFFSET = (() => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', timeZoneName: 'longOffset' })
    .formatToParts(new Date());
  const name = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT+07:00';
  return name.replace('GMT', '') || '+07:00';
})();

/** แยกส่วนเวลาไทยด้วย Intl (ไม่บวก 7 ชั่วโมงเอง) · hourCycle h23 กันเที่ยงคืนกลายเป็น 24:00 */
const BKK_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** ISO-8601 เวลาไทยพร้อม offset: '2026-09-13T14:05:00+07:00' */
function thaiIso(date: Date): string {
  const part: Record<string, string> = {};
  for (const { type, value } of BKK_PARTS.formatToParts(date)) part[type] = value;
  return `${part.year}-${part.month}-${part.day}T${part.hour}:${part.minute}:${part.second}${BKK_OFFSET}`;
}

/** สตางค์ → สตริงบาททศนิยม 2 ตำแหน่ง ด้วยเลขจำนวนเต็มล้วน (ไม่ผ่าน float) — ห้ามมี ฿ หรือ , */
function satangToThb(satang: number): string {
  const value = toSatang(satang, 'จำนวนเงินที่ส่งออก');
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** ต้องครอบด้วย " ไหม — เมื่อมี comma/"/ขึ้นบรรทัดใหม่ หรือมีช่องว่างหัวท้าย (RFC 4180 + กติกาช่องว่างของเรา) */
const needsQuote = (value: string): boolean => /[",\r\n]/.test(value) || value !== value.trim();

/** ฟิลด์ CSV หนึ่งช่อง — ครอบด้วย " แล้วซ้ำ " เป็น "" ตาม RFC 4180 */
const csvField = (value: string): string => (needsQuote(value) ? `"${value.replace(/"/g, '""')}"` : value);

/**
 * อักขระที่สเปรดชีตถือว่า "เริ่มสูตร" — `=`,`+`,`-`,`@` และ TAB/CR (ชุดเดียวกับที่ OWASP แนะนำ)
 * ผู้ใช้ที่แชร์ไฟล์ CSV ให้คนอื่นจะไม่ถูกสั่งรันสูตรจากโน้ตที่พิมพ์ขึ้นต้นด้วยอักขระเหล่านี้
 */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * ฟิลด์ข้อความของ CSV — กัน formula injection ด้วยการเติม `'` นำหน้า **แล้ว** escape ตาม RFC 4180
 *
 * เจตนาที่ชัดเจน: เป็นการ "ดัด" ค่าเฉพาะไฟล์ CSV (เอาไปเปิดในสเปรดชีต) · ไฟล์ JSON (สำรองข้อมูล)
 * **ไม่ถูกดัดเลย** — ค่าจริงของผู้ใช้อยู่ครบตามหลัก fidelity
 * ตัวเลขของเราเอง (amount_satang/amount_thb) ไม่ผ่านที่นี่: ต้องเป็นตัวเลขให้ชีตคำนวณได้
 */
const csvText = (value: string): string => csvField(FORMULA_START.test(value) ? `'${value}` : value);

/**
 * รายการ → ไฟล์ CSV (ทั้งไฟล์เป็นสตริงเดียว) — มี BOM นำหน้าและจบทุกบรรทัดด้วย CRLF
 * ไม่มีแถวก็ยังเป็นไฟล์ที่ถูกต้อง (มีแต่หัวตาราง)
 */
export function toCsv(rows: readonly ExportRow[]): string {
  const lines = [CSV_HEADERS.join(',')];
  for (const row of rows) {
    lines.push(
      [
        csvText(row.id),
        thaiIso(row.occurredAt),
        csvText(row.occurredMonth),
        csvText(row.kind),
        String(toSatang(row.amount, 'จำนวนเงินที่ส่งออก')),
        satangToThb(row.amount),
        csvText(row.currency),
        csvText(row.accountName),
        csvText(row.toAccountName ?? ''),
        csvText(row.categoryName ?? ''),
        csvText(row.note ?? ''),
        thaiIso(row.createdAt),
      ].join(','),
    );
  }
  return `${BOM}${lines.join(CRLF)}${CRLF}`;
}

/**
 * ข้อมูลสำรอง → ไฟล์ JSON (compact, ไม่มี BOM)
 * ประกอบออบเจกต์ใหม่ (ไม่ stringify ของเดิม) เพื่อคุมคีย์/ชนิดที่ออกไฟล์ได้แน่นอน:
 * เวลาเป็น ISO (UTC) · เงินเป็นสตางค์จำนวนเต็มผ่าน toSatang() ทุกตัว · ไม่มี Date หลุดเป็นอย่างอื่น
 */
export function toJson(snapshot: BackupData): string {
  const iso = (date: Date | null): string | null => (date === null ? null : date.toISOString());

  return JSON.stringify({
    exportedAt: snapshot.exportedAt,
    counts: {
      accounts: snapshot.counts.accounts,
      categories: snapshot.counts.categories,
      budgets: snapshot.counts.budgets,
      transactions: snapshot.counts.transactions,
      excludedDeleted: snapshot.counts.excludedDeleted,
    },
    accounts: snapshot.accounts.map((account) => ({
      id: account.id,
      name: account.name,
      kind: account.kind,
      currency: account.currency,
      initialBalance: toSatang(account.initialBalance, 'ยอดตั้งต้นของกระเป๋า'),
      icon: account.icon,
      color: account.color,
      archivedAt: iso(account.archivedAt),
      createdAt: account.createdAt.toISOString(),
    })),
    categories: snapshot.categories.map((category) => ({
      id: category.id,
      kind: category.kind,
      name: category.name,
      icon: category.icon,
      color: category.color,
      sortOrder: category.sortOrder,
      archivedAt: iso(category.archivedAt),
      createdAt: category.createdAt.toISOString(),
    })),
    budgets: snapshot.budgets.map((budget) => ({
      id: budget.id,
      categoryId: budget.categoryId,
      periodMonth: budget.periodMonth,
      amount: toSatang(budget.amount, 'งบประมาณ'),
      currency: budget.currency,
      createdAt: budget.createdAt.toISOString(),
      updatedAt: budget.updatedAt.toISOString(),
    })),
    transactions: snapshot.transactions.map((row) => ({
      id: row.id,
      occurredAt: row.occurredAt.toISOString(),
      occurredMonth: row.occurredMonth,
      kind: row.kind,
      amount: toSatang(row.amount, 'จำนวนเงินที่ส่งออก'),
      currency: row.currency,
      accountName: row.accountName,
      toAccountName: row.toAccountName,
      categoryName: row.categoryName,
      note: row.note,
      createdAt: row.createdAt.toISOString(),
    })),
  });
}
