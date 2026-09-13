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
import { type SQL, and, desc, eq, gte, ilike, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';

import {
  MONEY_KINDS,
  expenseByCategory as sumExpenseByCategory,
  periodTotals,
  satangFromDb,
  type MoneyRow,
  type Totals,
  type TxnKind,
} from '../../lib/money.ts';
import { shiftPeriodMonth, type PeriodMonth } from '../../lib/month.ts';
import type { Db } from '../index.ts';
import { transactions, categories } from '../schema.ts';

/** งวดเดือนไทย ('YYYY-MM-01') — นิยามจริงอยู่ที่ src/lib/month.ts (ที่เดียวที่คิดเดือน) ส่งต่อเพื่อไม่ให้มี 2 นิยาม */
export type { PeriodMonth };

/** คอลัมน์มาตรฐานของแถวรายการ — ใช้ร่วมกับ write path (src/db/mutations) */
export const TXN_COLUMNS = {
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
/** แปลงแถวจาก DB → TxnRow ใช้ร่วมกับ write path (cast kind จุดเดียว) */
export const toRows = (rows: Selected[]): TxnRow[] => rows.map((row) => ({ ...row, kind: row.kind as TxnKind }));

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

/**
 * escape อักขระพิเศษของ LIKE (% _ \) ก่อนเอาไปครอบ %...%
 * ถ้าไม่ escape: พิมพ์ '_' จะได้ทุกตัวอักษร · พิมพ์ '%' จะได้ทุกแถว · พิมพ์ '\' จะพัง (pattern ลงท้ายด้วย escape char)
 * PG ใช้ \ เป็น escape char เป็น default อยู่แล้ว จึงไม่ต้องเติม escape clause (docs/query-review.md ข้อ 4)
 */
const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (char) => `\\${char}`);

export type KeysetCursor = { occurredAt: Date; id: string };

/** รายการของเดือน (เฉพาะรับ/จ่าย — transfer ไม่เป็นทั้งรับและจ่าย ตาม money.ts) */
export async function monthRows(db: Db, userId: string, periodMonth: PeriodMonth): Promise<TxnRow[]> {
  const rows = await db
    .select(TXN_COLUMNS)
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
 * ตัวกรองของหน้ารายการทั้งหมด (S4) — ทุกตัว optional และรวมกันได้ (AND)
 * (เดิมมี query แยกสำหรับหน้าแรกที่ "ไม่กรองงวดเดือน" — ลบใน wave7b: หน้าแรกใช้ listTransactionPage({periodMonth})
 *  แทน เพราะคืนรายการข้ามเดือน ซึ่งเป็นบั๊กจริง)
 */
export type TransactionFilters = {
  periodMonth?: PeriodMonth;
  /** กรองหลายหมวดพร้อมกัน · ส่ง [] = ไม่มีอะไรตรง (ไม่ยิง DB) */
  categoryIds?: readonly string[];
  kind?: TxnKind;
  /** กระเป๋า — ตรงฝั่งต้นทาง (account_id) หรือปลายทางของโอน (to_account_id) */
  accountId?: string;
  /** ค้นข้อความใน note **และชื่อหมวด** ของผู้ใช้คนนี้ (ดูหมายเหตุใน listTransactionPage) */
  q?: string;
  /** หน้าถัดไป: ส่ง nextCursor ของหน้าก่อนกลับมา (keyset — ไม่ใช้ OFFSET) */
  cursor?: KeysetCursor;
  /** จำนวนแถวต่อหน้า (default 50) — clamp ไว้ที่ 1..100 */
  limit?: number;
};

export type TransactionPage = {
  rows: TxnRow[];
  /** cursor ของหน้าถัดไป · null = หมดแล้ว */
  nextCursor: KeysetCursor | null;
  /** จำนวนแถวทั้งหมดที่ "ตัวกรองนี้" ได้ (ไม่ใช่แค่หน้านี้) — เท่ากันทุกหน้า แม้หน้าสุดท้ายจะว่าง */
  total: number;
};

/** เพดานต่อหน้า — กัน UI ขอ 10000 แล้วลากทั้งตาราง */
const MAX_PAGE_LIMIT = 100;
const DEFAULT_PAGE_LIMIT = 50;

/** count(*) ของ PG กลับมาเป็น int8 (ไดรเวอร์อาจส่งเป็นสตริง) → number · จำนวนแถวไม่มีทางเกิน 2^53 ในทางปฏิบัติ */
const rowCount = (value: unknown): number => (typeof value === 'number' ? value : Number(value ?? 0));

const pageLimit = (limit?: number) => Math.min(Math.max(limit ?? DEFAULT_PAGE_LIMIT, 1), MAX_PAGE_LIMIT);

/** เงื่อนไขของ "ชุดที่กรองได้" — ไม่รวม cursor (ใช้ทั้งนับ total และเป็นฐานของเงื่อนไขหน้าปัจจุบัน) */
function filterConditions(db: Db, userId: string, filters: TransactionFilters): SQL<unknown>[] {
  const conditions: SQL<unknown>[] = [liveOf(userId)];
  if (filters.periodMonth) conditions.push(eq(transactions.occurredMonthBkk, filters.periodMonth));
  if (filters.categoryIds) conditions.push(inArray(transactions.categoryId, [...filters.categoryIds]));
  if (filters.kind) conditions.push(eq(transactions.kind, filters.kind));
  if (filters.accountId) {
    conditions.push(
      or(eq(transactions.accountId, filters.accountId), eq(transactions.toAccountId, filters.accountId)) as SQL<unknown>,
    );
  }
  if (filters.q) {
    // ค้นทั้ง "โน้ต" และ "ชื่อหมวด" (design.md §4 S4 + spec §2: คนไทยพิมพ์ชื่อหมวดบ่อยกว่าเขียนโน้ต)
    // ใช้ subquery แทนการยิงหา categoryId ก่อน = ยังเป็น 1 query ต่อหน้า และเลี่ยงกับดัก inArray([])
    // (ไม่มีหมวดที่ชื่อตรง → subquery ว่าง → เทอมนี้เป็น false แล้ว OR จึงเหลือแค่เงื่อนไขโน้ต ไม่ใช่ได้ 0 แถวเสมอ)
    const pattern = `%${escapeLike(filters.q)}%`;
    const matchedCategories = db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.userId, userId), ilike(categories.name, pattern)));
    conditions.push(
      or(ilike(transactions.note, pattern), inArray(transactions.categoryId, matchedCategories)) as SQL<unknown>,
    );
  }
  return conditions;
}

/** นับแถวของชุดที่กรองได้ (ไม่รวม cursor) — ใช้เฉพาะกรณีหน้าว่างที่มี cursor (ดู listTransactionPage) */
async function countFiltered(db: Db, userId: string, filters: TransactionFilters): Promise<number> {
  const rows = await db
    .select({ total: sql<unknown>`count(*)` })
    .from(transactions)
    .where(and(...filterConditions(db, userId, filters)));
  return rowCount(rows[0]?.total ?? 0);
}

/**
 * query ของหน้า "รายการทั้งหมด" — แยก builder ออกมาให้เทสต์ EXPLAIN ตรวจได้ว่า SQL ตัวนี้ใช้ index ไหน
 * (เป็น query ตัวเดียวกับที่ listTransactionPage รันจริง ไม่ใช่ query คนละตัวที่เขียนซ้ำในเทสต์)
 */
export function transactionPageQuery(db: Db, userId: string, filters: TransactionFilters = {}) {
  const filtered = filterConditions(db, userId, filters);
  const conditions = filters.cursor ? [...filtered, afterCursor(filters.cursor)] : filtered;

  return db
    .select({
      ...TXN_COLUMNS,
      // total ต้องเป็นยอดของ "ทั้งชุดที่กรองได้" ไม่ใช่ของหน้านี้ → scalar subquery ที่ไม่มีเงื่อนไข cursor
      // (count(*) over () ใช้ไม่ได้: window จะนับเฉพาะแถวที่ผ่าน cursor แล้ว → เลขหดลงทุกครั้งที่กดโหลดเพิ่ม)
      total: sql<unknown>`(select count(*) from ${transactions} where ${and(...filtered)})`,
    })
    .from(transactions)
    .where(and(...conditions))
    .orderBy(desc(transactions.occurredAt), desc(transactions.id))
    .limit(pageLimit(filters.limit) + 1);
}

/**
 * รายการทั้งหมด (S4): ตัวกรอง + keyset ตาม (occurred_at desc, id desc) — ไม่ใช้ OFFSET
 * ปกติ = **1 query** ต่อหน้า (rows + total + nextCursor):
 *   - ดึง limit + 1 แถว → รู้ว่ามีหน้าถัดไปไหม แล้วตัดแถวเกินทิ้ง
 *   - total มาจาก scalar subquery ที่นับด้วยตัวกรองชุดเดียวกัน "ยกเว้น cursor" → เท่ากันทุกหน้า
 * ข้อยกเว้น: หน้าว่าง *ที่มี cursor* (กดโหลดเพิ่มจนหมด) — ไม่มีแถวให้อ่านคอลัมน์ total จึงยิง count เพิ่ม 1 ครั้ง
 *   เพื่อไม่ให้ผู้ใช้เห็น "0 รายการ" ทั้งที่ตัวกรองยังตรงอยู่ (รีวิว wave7b ข้อ 2)
 */
export async function listTransactionPage(
  db: Db,
  userId: string,
  filters: TransactionFilters = {},
): Promise<TransactionPage> {
  if (filters.categoryIds && filters.categoryIds.length === 0) return { rows: [], nextCursor: null, total: 0 };

  const rows = await transactionPageQuery(db, userId, filters);
  if (rows.length === 0) {
    return { rows: [], nextCursor: null, total: filters.cursor ? await countFiltered(db, userId, filters) : 0 };
  }

  const limit = pageLimit(filters.limit);
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const tail = pageRows[pageRows.length - 1];

  return {
    rows: toRows(pageRows),
    nextCursor: hasMore && tail ? { occurredAt: tail.occurredAt, id: tail.id } : null,
    total: rowCount(rows[0].total),
  };
}

/** 1 เดือนของแนวโน้ม — สตางค์ทั้งหมด (สูตรอยู่ src/lib/money.ts) */
export type MonthTrend = {
  periodMonth: PeriodMonth;
  income: number;
  expense: number;
  balance: number;
};

/**
 * แนวโน้ม N งวดจบที่ endPeriodMonth (เรียงเก่า → ใหม่) — **1 query** ไม่ใช่ N
 * รับ "เดือนสุดท้าย" เป็นพารามิเตอร์ (ไม่ยึดเดือนปัจจุบัน) เพราะหน้า /summary ให้ผู้ใช้สลับเดือนได้
 * เดือนที่ไม่มีข้อมูลได้ 0 ครบทุกงวด (สร้างแถวจาก src/lib/month.ts ไม่ใช่ให้ UI เติมเอง)
 * transfer ไม่ถูกนับ (กติกา isCounted ใน money.ts) · ยอดคงเหลือคิดผ่าน periodTotals() ที่เดียว
 */
export async function trendByMonth(
  db: Db,
  userId: string,
  endPeriodMonth: PeriodMonth,
  months = 6,
): Promise<MonthTrend[]> {
  if (!Number.isSafeInteger(months) || months < 1) {
    throw new TypeError(`months ต้องเป็นจำนวนเต็ม ≥ 1 (ได้ ${String(months)})`);
  }

  const periodMonths = Array.from({ length: months }, (_, index) =>
    shiftPeriodMonth(endPeriodMonth, index - (months - 1)),
  );
  const [first] = periodMonths;

  const rows = await db
    .select({
      periodMonth: transactions.occurredMonthBkk,
      kind: transactions.kind,
      total: sql<unknown>`sum(${transactions.amount})`,
    })
    .from(transactions)
    .where(
      and(
        liveOf(userId),
        inArray(transactions.kind, [...MONEY_KINDS]),
        gte(transactions.occurredMonthBkk, first),
        lte(transactions.occurredMonthBkk, endPeriodMonth),
      ),
    )
    .groupBy(transactions.occurredMonthBkk, transactions.kind);

  const byMonth = new Map<string, { income: number; expense: number }>();
  for (const row of rows) {
    // occurred_month_bkk เป็น null ไม่ได้จริง (generated จาก occurred_at ที่ not null) — เช็คไว้ให้ชนิดถูกต้อง
    if (row.periodMonth === null) continue;
    const bucket = byMonth.get(row.periodMonth) ?? { income: 0, expense: 0 };
    if (row.kind === 'income') bucket.income = satangFromDb(row.total, 'ยอดรับของเดือน');
    else bucket.expense = satangFromDb(row.total, 'ยอดจ่ายของเดือน');
    byMonth.set(row.periodMonth, bucket);
  }

  return periodMonths.map((periodMonth) => {
    const bucket = byMonth.get(periodMonth) ?? { income: 0, expense: 0 };
    // ยอดคงเหลือมาจาก periodTotals() ที่เดียว (ไม่บวก/ลบเงินเองในชั้น query)
    const { balance } = periodTotals([
      { kind: 'income', amount: bucket.income, accountId: '' },
      { kind: 'expense', amount: bucket.expense, accountId: '' },
    ]);
    return { periodMonth, income: bucket.income, expense: bucket.expense, balance };
  });
}
