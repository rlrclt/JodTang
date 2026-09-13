/**
 * Query layer ของหน้าแรก (S2) · รายการทั้งหมด (S4) · สรุป (S5)
 *
 * กติกาเหล็กของไฟล์นี้ (docs/schema.sql ข้อ 3-4 + คอมเมนต์หัวไฟล์ src/lib/money.ts):
 *   1. ทุก query ต้องมี userId ของ session + isNull(deletedAt) — ใช้ liveOf() เท่านั้น ห้ามประกอบเงื่อนไขเอง
 *      (กรองแค่ deleted_at = เห็นข้อมูลผู้ใช้คนอื่น · กรองแค่ user_id = เห็นรายการที่ลบแล้ว)
 *   2. ห้ามเขียนสูตรเงินในไฟล์นี้: ยอด/แยกหมวด เรียก periodTotals() · expenseByCategory() จาก src/lib/money.ts
 *   3. เงินเป็นสตางค์ bigint mode:'number' (schema.sql ข้อ 1)
 *   4. relative import + .ts ต่อท้าย เพราะเทสต์รันด้วย `node --test` ตรง ๆ ซึ่งไม่รู้จัก alias @/
 */
import { type SQL, and, desc, eq, ilike, inArray, isNull, lt, or } from 'drizzle-orm';

import {
  MONEY_KINDS,
  expenseByCategory as sumExpenseByCategory,
  periodTotals,
  type MoneyRow,
  type Totals,
  type TxnKind,
} from '../../lib/money.ts';
import type { Db } from '../index.ts';
import { transactions } from '../schema.ts';

/** 'YYYY-MM-01' ของเดือนไทย — เทียบ equality กับ transactions.occurred_month_bkk (generated stored) */
export type PeriodMonth = string;

const COLUMNS = {
  id: transactions.id,
  kind: transactions.kind,
  amount: transactions.amount,
  accountId: transactions.accountId,
  toAccountId: transactions.toAccountId,
  categoryId: transactions.categoryId,
  deletedAt: transactions.deletedAt,
  occurredAt: transactions.occurredAt,
};

/** แถวที่ส่งให้ UI: MoneyRow + id (React key/keyset) + occurredAt (keyset/แสดงวันที่) */
export type TxnRow = MoneyRow & { id: string; occurredAt: Date };

type Selected = {
  id: string;
  kind: string;
  amount: number;
  accountId: string;
  toAccountId: string | null;
  categoryId: string | null;
  deletedAt: Date | null;
  occurredAt: Date;
};

/** kind การันตีโดย check constraint transactions_kind_check ฝั่ง DB → cast ที่จุดเดียวนี้ */
const toRows = (rows: Selected[]): TxnRow[] => rows.map((row) => ({ ...row, kind: row.kind as TxnKind }));

/**
 * เงื่อนไขกลางของทุก query: ของผู้ใช้คนนี้ + ยังไม่ถูกลบ (ห้ามลบ/ห้ามข้าม)
 * drizzle's and() ประกาศคืน SQL | undefined เมื่ออาร์กิวเมนต์เป็นลิสต์ จึงยืนยันชนิดตรงจุดเดียวนี้
 */
const liveOf = (userId: string): SQL<unknown> =>
  and(eq(transactions.userId, userId), isNull(transactions.deletedAt)) as SQL<unknown>;

/** keyset: (occurred_at, id) < (cursor.occurred_at, cursor.id) — ไม่ใช้ OFFSET (schema.sql) */
const afterCursor = (cursor: KeysetCursor): SQL<unknown> =>
  or(
    lt(transactions.occurredAt, cursor.occurredAt),
    and(eq(transactions.occurredAt, cursor.occurredAt), lt(transactions.id, cursor.id)),
  ) as SQL<unknown>;

export type KeysetCursor = { occurredAt: Date; id: string };

/** รายการของเดือน (เฉพาะรับ/จ่าย — transfer ไม่เป็นทั้งรับและจ่าย ตาม money.ts) */
export async function monthRows(db: Db, userId: string, periodMonth: PeriodMonth): Promise<TxnRow[]> {
  const rows = await db
    .select(COLUMNS)
    .from(transactions)
    .where(
      and(liveOf(userId), inArray(transactions.kind, [...MONEY_KINDS]), eq(transactions.occurredMonthBkk, periodMonth)),
    );
  return toRows(rows);
}

/** ยอดรับ/จ่าย/คงเหลือของเดือน — สูตรอยู่ใน money.ts ที่เดียว */
export async function monthTotals(db: Db, userId: string, periodMonth: PeriodMonth): Promise<Totals> {
  return periodTotals(await monthRows(db, userId, periodMonth));
}

/** ยอดรายจ่ายแยกหมวดของเดือน (กราฟ S5) — สูตรอยู่ใน money.ts ที่เดียว */
export async function monthExpenseByCategory(
  db: Db,
  userId: string,
  periodMonth: PeriodMonth,
): Promise<Map<string, number>> {
  return sumExpenseByCategory(await monthRows(db, userId, periodMonth));
}

/**
 * หน้าแรก: รายการล่าสุด (keyset ตาม occurred_at desc, id desc)
 * แยกเป็น builder ให้เทสต์ EXPLAIN ได้ว่า SQL ตัวนี้ใช้ index ไหน (ไม่ใช่ query คนละตัว)
 */
export function recentTransactionsQuery(db: Db, userId: string, limit = 20, cursor?: KeysetCursor) {
  return db
    .select(COLUMNS)
    .from(transactions)
    .where(cursor ? and(liveOf(userId), afterCursor(cursor)) : liveOf(userId))
    .orderBy(desc(transactions.occurredAt), desc(transactions.id))
    .limit(limit);
}

export async function recentTransactions(
  db: Db,
  userId: string,
  limit = 20,
  cursor?: KeysetCursor,
): Promise<TxnRow[]> {
  return toRows(await recentTransactionsQuery(db, userId, limit, cursor));
}

export type ListFilters = {
  periodMonth?: PeriodMonth;
  kind?: TxnKind;
  categoryId?: string;
  accountId?: string;
  /** ponytail: ค้นหาเฉพาะ transactions.note — ค้นชื่อหมวดต้อง join categories เพิ่มเมื่อ UI ต้องการจริง */
  search?: string;
  cursor?: KeysetCursor;
  limit?: number;
};

/** รายการทั้งหมด (S4): filter + ค้นหา + keyset — เลื่อนไม่จำกัดด้วย cursor ไม่ใช้ OFFSET */
export async function listTransactions(db: Db, userId: string, filters: ListFilters = {}): Promise<TxnRow[]> {
  const conditions: SQL<unknown>[] = [liveOf(userId)];
  if (filters.periodMonth) conditions.push(eq(transactions.occurredMonthBkk, filters.periodMonth));
  if (filters.kind) conditions.push(eq(transactions.kind, filters.kind));
  if (filters.categoryId) conditions.push(eq(transactions.categoryId, filters.categoryId));
  if (filters.accountId) conditions.push(eq(transactions.accountId, filters.accountId));
  if (filters.search) conditions.push(ilike(transactions.note, `%${filters.search}%`));
  if (filters.cursor) conditions.push(afterCursor(filters.cursor));

  const rows = await db
    .select(COLUMNS)
    .from(transactions)
    .where(and(...conditions))
    .orderBy(desc(transactions.occurredAt), desc(transactions.id))
    .limit(filters.limit ?? 50);
  return toRows(rows);
}
