/**
 * ที่เดียวที่คำนวณยอดเงินของทั้งแอป (กติกา docs/schema.sql ข้อ 1–4 · รูปแบบตาม docs/design.md §1.2)
 *
 * กติกาที่บังคับในไฟล์นี้ (อย่าไปทำซ้ำที่อื่น):
 *   1. เงินเก็บเป็น "สตางค์" จำนวนเต็ม (bigint ฝั่ง DB) — หาร/คูณ 100 เกิดที่ formatSatang() เท่านั้น
 *   2. amount เป็นบวกเสมอ ทิศทาง (รับ/จ่าย) มาจาก kind ไม่ใช่เครื่องหมาย
 *   3. ยอดรับ/จ่าย: นับเฉพาะ kind in MONEY_KINDS และ deleted_at is null — transfer ไม่เคยเป็นรับ/จ่าย
 *   4. ยอดคงเหลือ: initial_balance + income − expense แล้วบวกผล transfer
 *      (หักฝั่ง account_id · เพิ่มฝั่ง to_account_id)
 *   5. แถวที่ soft delete แล้วต้องไม่กระทบยอดใด ๆ (รวม transfer)
 *
 * ไฟล์นี้ไม่ import อะไรเลยโดยตั้งใจ เพื่อให้เทสต์รันได้ด้วย `node --test` ก่อนมี dependencies
 * (ชั้น query ตอนเฟส 2 ต้องดึง MONEY_KINDS ไปใช้กับ inArray() + isNull(deletedAt) ไม่ใช่เขียนลิสต์เอง)
 */

export const MONEY_KINDS = ["income", "expense"] as const;

export type MoneyKind = (typeof MONEY_KINDS)[number];
export type TxnKind = MoneyKind | "transfer";

export type MoneyRow = {
  kind: TxnKind;
  /** สตางค์ เป็นบวกเสมอ (DB: amount > 0) */
  amount: number;
  accountId: string;
  toAccountId?: string | null;
  /** null/undefined = ยังไม่ถูกลบ */
  deletedAt?: Date | string | null;
};

export type Totals = {
  income: number;
  expense: number;
  /** income − expense (ไม่รวมผล transfer) */
  balance: number;
};

/** แถวนี้ถูกนับเป็นยอด "รับ/จ่าย" ไหม — ที่เดียวที่ตัดสินกติกานี้ */
export function isCounted(row: MoneyRow): boolean {
  return !row.deletedAt && (row.kind === "income" || row.kind === "expense");
}

/**
 * ยอดรับ/จ่าย/คงเหลือของชุดแถวที่ส่งมา
 * ผู้เรียกเป็นคนจำกัดช่วงเวลา (เช่น occurred_month_bkk = date '2026-09-01') — ฟังก์ชันนี้ไม่เดาเดือนเอง
 */
export function periodTotals(rows: readonly MoneyRow[]): Totals {
  let income = 0;
  let expense = 0;
  for (const row of rows) {
    if (!isCounted(row)) continue;
    if (row.kind === "income") income += row.amount;
    else expense += row.amount;
  }
  return { income, expense, balance: income - expense };
}

/** ยอดคงเหลือของกระเป๋าเดียว = initial + income − expense ± transfer */
export function accountBalance(
  rows: readonly MoneyRow[],
  accountId: string,
  initialBalance = 0,
): number {
  let sum = initialBalance;
  for (const row of rows) {
    if (row.deletedAt) continue;
    if (row.kind === "income") {
      if (row.accountId === accountId) sum += row.amount;
    } else if (row.kind === "expense") {
      if (row.accountId === accountId) sum -= row.amount;
    } else {
      if (row.accountId === accountId) sum -= row.amount;
      if (row.toAccountId === accountId) sum += row.amount;
    }
  }
  return sum;
}

const THB = new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" });
const THB_SIGNED = new Intl.NumberFormat("th-TH", {
  style: "currency",
  currency: "THB",
  signDisplay: "always",
});

/**
 * สตางค์ -> ข้อความเงินไทย ("฿1,234.00" · signed = "+฿1,234.00"/"−…")
 * นี่คือที่เดียวที่หาร 100 — ห้ามหาร 100 กระจายในโค้ดอื่น (design.md §1.2)
 */
export function formatSatang(satang: number, opts: { signed?: boolean } = {}): string {
  if (!Number.isInteger(satang)) {
    throw new TypeError(`จำนวนเงินต้องเป็นสตางค์จำนวนเต็ม (ได้ ${satang})`);
  }
  return (opts.signed ? THB_SIGNED : THB).format(satang / 100);
}

/**
 * ข้อความเงินของรายการ พร้อมเครื่องหมายตามทิศทาง (รับ = +, จ่าย/โอน = −)
 * ที่เดียวที่ตัดสินเครื่องหมาย — component ห้ามลบ/เติม +/- เอง (design.md §1.1: ห้ามใช้สีอย่างเดียวสื่อความหมาย)
 */
export function formatRowAmount(
  row: Pick<MoneyRow, "kind" | "amount">,
  opts: { signed?: boolean } = { signed: true },
): string {
  return formatSatang(row.kind === "income" ? row.amount : -row.amount, opts);
}
