/**
 * ที่เดียวที่คำนวณยอดเงินของทั้งแอป (กติกา docs/schema.sql ข้อ 1–4 · รูปแบบตาม docs/design.md §1.2)
 *
 * กติกาที่บังคับในไฟล์นี้ (อย่าไปทำซ้ำที่อื่น):
 *   1. เงินเก็บเป็น "สตางค์" จำนวนเต็ม (bigint ฝั่ง DB) — หาร/คูณ 100 เกิดที่ formatSatang() เท่านั้น
 *   2. amount เป็นบวกเสมอ ทิศทาง (รับ/จ่าย) มาจาก kind ไม่ใช่เครื่องหมาย
 *   3. ยอดรับ/จ่าย: นับเฉพาะ kind in MONEY_KINDS และ deleted_at is null — transfer ไม่เคยเป็นรับ/จ่าย
 *   4. ยอดคงเหลือ: initial_balance + income − expense แล้วบวกผล transfer
 *      (หักฝั่ง account_id · เพิ่มฝั่ง to_account_id)
 *   5. แถวที่ soft delete แล้วต้องไม่กระทบยอดใด ๆ (รวม transfer) — "ลบแล้ว" หมายถึง deletedAt != null เท่านั้น
 *      (สตริงว่าง '' ไม่ใช่ "ยังไม่ลบ" — เคยเป็น fail-open มาก่อน)
 *   6. ยอดรวมต้องอยู่ในช่วง Number.isSafeInteger — เกินกว่านั้นเพี้ยนเงียบ (11 แถวที่ขนาดเพดาน 1e15 เพี้ยนจริง 1 สตางค์)
 *      ฟังก์ชันในไฟล์นี้ throw ทันทีถ้าหลุด ไม่ปล่อยยอดเพี้ยนออกไปแสดง
 *
 * ⚠ ไฟล์นี้คำนวณจาก "แถวที่ผู้เรียกส่งมา" — มันบังคับ deleted_at/kind ได้ แต่บังคับ user_id ไม่ได้
 *   ทุก query ที่ดึงแถวมาให้ฟังก์ชันเหล่านี้ **ต้องมี user_id = <session user>** เสมอ (schema.sql ข้อ 3)
 *   กรองแค่ deleted_at is null = รวมข้อมูลผู้ใช้คนอื่น (isNull(deletedAt) เพียงอย่างเดียวไม่พอ)
 *
 * ไฟล์นี้ไม่ import อะไรเลยโดยตั้งใจ เพื่อให้เทสต์รันได้ด้วย `node --test` ก่อนมี dependencies
 * (ชั้น query ตอนเฟส 2 ต้องดึง MONEY_KINDS ไปใช้กับ inArray() + isNull(deletedAt) + eq(userId, ...) ไม่ใช่เขียนลิสต์เอง)
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

/**
 * ด่านเดียวของ "จำนวนเงิน" ทุกค่าที่เข้าฟังก์ชันในไฟล์นี้
 * บังคับ: ต้องเป็น number (ไม่ใช่ string/BigInt) และเป็นสตางค์จำนวนเต็มในช่วง safe integer
 *
 * ทำไมต้องมี: ถ้ารับ string มา บวกจะ "ต่อสตริง" เงียบ ๆ เช่น initial 100 + '2450000' + '1284000'
 * เคยคืน 1,001,166,000 แทน 1,166,100 (ยอดผิดแต่ไม่มี error — เส้นทางเงียบที่แย่ที่สุดสำหรับเงิน)
 * ค่าที่ไม่ผ่านต้องล้มเสียงดัง ไม่ใช่คืนยอดเพี้ยน
 */
export function toSatang(value: unknown, label = 'จำนวนเงิน'): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new TypeError(
      `${label}ต้องเป็น number สตางค์จำนวนเต็มในช่วง safe integer (ได้ ${typeof value}: ${String(value)})`,
    );
  }
  return value;
}

/** แถวนี้ถูกนับเป็นยอด "รับ/จ่าย" ไหม — ที่เดียวที่ตัดสินกติกานี้ */
export function isCounted(row: MoneyRow): boolean {
  return row.deletedAt == null && (row.kind === "income" || row.kind === "expense");
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
    const amount = toSatang(row.amount, "amount ของแถว"); // ตรวจ input ก่อนบวก ไม่ใช่ตรวจยอดหลังรวม
    if (row.kind === "income") income += amount;
    else expense += amount;
  }
  if (!Number.isSafeInteger(income) || !Number.isSafeInteger(expense)) {
    throw new RangeError(
      `ยอดรวมหลุดช่วง safe integer (income=${income} · expense=${expense}) — ยอดเพี้ยนแล้ว ห้ามแสดง`,
    );
  }
  return { income, expense, balance: income - expense };
}

/** ยอดคงเหลือของกระเป๋าเดียว = initial + income − expense ± transfer */
export function accountBalance(
  rows: readonly MoneyRow[],
  accountId: string,
  initialBalance = 0,
): number {
  let sum = toSatang(initialBalance, "ยอดตั้งต้น");
  for (const row of rows) {
    if (row.deletedAt != null) continue;
    const amount = toSatang(row.amount, "amount ของแถว"); // กันเงินเป็นสตริงแล้วต่อกันเงียบ ๆ
    if (row.kind === "income") {
      if (row.accountId === accountId) sum += amount;
    } else if (row.kind === "expense") {
      if (row.accountId === accountId) sum -= amount;
    } else if (row.kind === "transfer") {
      // kind ที่ไม่รู้จักต้องไม่ถูกหักเงินราวกับเป็น transfer (fail-open เดิม)
      if (row.accountId === accountId) sum -= amount;
      if (row.toAccountId === accountId) sum += amount;
    }
  }
  if (!Number.isSafeInteger(sum)) {
    throw new RangeError(`ยอดคงเหลือหลุดช่วง safe integer (${sum}) — ยอดเพี้ยนแล้ว ห้ามแสดง`);
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
  return (opts.signed ? THB_SIGNED : THB).format(toSatang(satang) / 100);
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
