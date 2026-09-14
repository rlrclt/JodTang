/**
 * ชั้นข้อมูลของ "ส่งออกข้อมูลของตัวเอง" (CSV รายการ + JSON สำรอง) — คู่กับ src/lib/export-format.ts (ตัวจัดรูปแบบ)
 *
 * กติกา (สเปก local://wave27-design.md §1-§3):
 *   1. ทุก query ผูกกับ userId ของ session เท่านั้น และ **กรอง `deleted_at is null`** ผ่าน liveOf() ตัวเดียวกับ
 *      หน้าจออื่น (รายการที่ลบแล้วมีถังขยะกู้คืนอยู่แล้ว — ไม่ปนลงไฟล์) · ของผู้ใช้คนอื่นไม่มีทางหลุด
 *   2. ชื่อกระเป๋า/ปลายทาง/หมวด join มาใน query เดียว — **ห้าม N+1** (เทสต์นับ query จริงไว้ใน export.test.ts)
 *   3. keyset cursor เดิมของรายการ (occurred_at desc, id desc) — ไม่มี OFFSET · ลำดับเดียวกับหน้าจอ
 *   4. เพดาน MAX_EXPORT_ROWS ต่อการส่งออกหนึ่งครั้ง: ถ้าเกิน route ต้องตอบข้อความไทย **ห้ามส่งไฟล์ครึ่งเดียว**
 *      → `exportTransactionRows()` ไม่โยนเอง (คืน `total` ให้ route ตัดสิน) แต่ `buildBackupSnapshot()` โยนเอง
 *      เพราะไฟล์สำรองที่ขาดข้อมูลคือไฟล์ที่ "ดูเหมือนครบ" — อันตรายกว่า
 *   5. กระเป๋า/หมวดที่ถูก archive แล้ว **ต้องอยู่ในไฟล์** (รายการเก่าอ้างถึง) — จึงไม่กรอง archived_at ที่นี่
 *      ต่างจากหน้ากระเป๋า/หมวดที่ซ่อนของที่เลิกใช้
 *   6. งบประมาณเป็น "แผนต่อเดือน" → ไม่อยู่ใน CSV และไม่ผูกกับเดือนที่ส่งออก (ไฟล์สำรองต้องครบทุกเดือน)
 */
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import type {
  BackupAccount,
  BackupBudget,
  BackupCategory,
  BackupData,
  ExportRow,
} from '../../lib/export-format.ts';
import type { PeriodMonth } from '../../lib/month.ts';
import { ValidationError } from '../errors.ts';
import type { Db } from '../index.ts';
import { accounts, budgets, categories, transactions } from '../schema.ts';
import { afterCursor, liveOf, rowCount, type KeysetCursor } from './transactions.ts';

/** เพดานแถวต่อการส่งออกหนึ่งครั้ง (สเปก §3) — เกินกว่านี้ต้องกรองตามเดือน ไม่ใช่ได้ไฟล์ที่โหลดครึ่งเดียว */
export const MAX_EXPORT_ROWS = 20_000;

/** หน้าเดียวของ CSV: แถวมากพอให้ round trip ไม่เยอะ แต่ยังคุมหน่วยความจำต่อหน้าได้ (~1,000 แถว ≈ 200 KiB) */
const DEFAULT_EXPORT_LIMIT = 1_000;
const MAX_EXPORT_LIMIT = 5_000;

const exportLimit = (limit?: number): number =>
  Math.min(Math.max(limit ?? DEFAULT_EXPORT_LIMIT, 1), MAX_EXPORT_LIMIT);

export type ExportOptions = {
  /** งวดเดือนไทย ('YYYY-MM-01') — ไม่ส่ง = ทุกเดือน (route ส่งค่าที่ผ่าน monthScopeFromParam มาให้) */
  periodMonth?: PeriodMonth;
  /** หน้าถัดไป: ส่ง nextCursor ของหน้าก่อนกลับมา (keyset — ไม่ใช้ OFFSET) */
  cursor?: KeysetCursor;
  /** จำนวนแถวต่อหน้า (default 1,000 · clamp 1..5,000) */
  limit?: number;
};

export type ExportPage = {
  rows: ExportRow[];
  /** cursor ของหน้าถัดไป · null = หมดแล้ว */
  nextCursor: KeysetCursor | null;
  /** จำนวนแถวทั้งชุดของ scope นี้ (ไม่ขึ้นกับหน้า) — route ใช้เช็คเพดานก่อนสร้างไฟล์ */
  total: number;
};

/** เงื่อนไขของ "ชุดที่ส่งออก" — ไม่รวม cursor (ใช้ทั้งเป็นฐานของหน้าและเป็นตัวนับ total) */
const exportConditions = (userId: string, periodMonth?: PeriodMonth) => {
  const conditions = [liveOf(userId)];
  if (periodMonth) conditions.push(eq(transactions.occurredMonthBkk, periodMonth));
  return conditions;
};

/**
 * query ของไฟล์ส่งออก — แยก builder ให้เทสต์ EXPLAIN/นับ query ตรวจได้ (ตัวเดียวกับที่ exportTransactionRows รัน)
 * join 3 ทาง: กระเป๋าต้นทาง (inner — account_id เป็น not null เสมอ) · กระเป๋าปลายทาง (left, เฉพาะโอน) ·
 * หมวด (left, เฉพาะ transfer ที่ไม่มีหมวด) — alias เพราะ join ตาราง accounts สองครั้งในคำสั่งเดียว
 */
export function exportTransactionQuery(db: Db, userId: string, options: ExportOptions = {}) {
  const toAccounts = alias(accounts, 'to_accounts');
  const filtered = exportConditions(userId, options.periodMonth);
  const conditions = options.cursor ? [...filtered, afterCursor(options.cursor)] : filtered;

  return db
    .select({
      id: transactions.id,
      occurredAt: transactions.occurredAt,
      // คอลัมน์ generate ของ DB ('YYYY-MM-01' งวดเดือนไทย) — ส่งออกค่าที่ DB ตรึงไว้ ไม่คำนวณซ้ำในแอป
      // DDL ไม่ได้ประกาศ NOT NULL แต่สูตรคิดจาก occurred_at (not null) ⇒ ค่าไม่มีทางเป็น null จึงระบุชนิดให้ตรง
      occurredMonth: sql<string>`${transactions.occurredMonthBkk}`,
      kind: transactions.kind,
      amount: transactions.amount,
      currency: transactions.currency,
      accountName: accounts.name,
      toAccountName: toAccounts.name,
      categoryName: categories.name,
      note: transactions.note,
      createdAt: transactions.createdAt,
      // total ต้องเป็นยอดของทั้งชุดที่กรองได้ (ไม่รวม cursor) → เท่ากันทุกหน้า จึงเป็น scalar subquery
      total: sql<unknown>`(select count(*) from ${transactions} where ${and(...filtered)})`,
    })
    .from(transactions)
    .innerJoin(accounts, and(eq(accounts.id, transactions.accountId), eq(accounts.userId, transactions.userId)))
    .leftJoin(
      toAccounts,
      and(eq(toAccounts.id, transactions.toAccountId), eq(toAccounts.userId, transactions.userId)),
    )
    .leftJoin(
      categories,
      and(eq(categories.id, transactions.categoryId), eq(categories.userId, transactions.userId)),
    )
    .where(and(...conditions))
    .orderBy(desc(transactions.occurredAt), desc(transactions.id))
    .limit(exportLimit(options.limit) + 1);
}

/**
 * หน้ารายการสำหรับส่งออก — **1 query ต่อหน้า** (rows + total + nextCursor ในคำสั่งเดียว)
 * ดึง limit + 1 แถวเพื่อรู้ว่ามีหน้าถัดไปไหม แล้วตัดแถวเกินทิ้ง (แบบเดียวกับ listTransactionPage)
 * ข้อยกเว้นเดียวกับลิสต์หน้าจอ: หน้าว่าง *ที่มี cursor* (ไล่จนหมด) → ยิง count เพิ่ม 1 ครั้ง เพื่อให้ `total` ยังถูก
 */
/**
 * ตัด `total` (ฟิลด์ช่วยที่มาจาก scalar subquery ในคำสั่งเดียวกัน) ออก — แถวที่ออกจากชั้นนี้จึงมีเฉพาะ
 * ฟิลด์ตามสัญญาไฟล์ (กัน `total` หลุดลง CSV/JSON โดยไม่ตั้งใจในอนาคต)
 * `void total;` = บอกเจตนาว่าตัดทิ้ง ไม่ใช่ลืมใช้ (โปรเจกต์นี้ไม่มี eslint-disable)
 */
const withoutTotal = ({ total, ...row }: ExportRow & { total: unknown }): ExportRow => {
  void total;
  return row;
};

export async function exportTransactionRows(
  db: Db,
  userId: string,
  options: ExportOptions = {},
): Promise<ExportPage> {
  const rows = await exportTransactionQuery(db, userId, options);

  if (rows.length === 0) {
    return {
      rows: [],
      nextCursor: null,
      total: options.cursor ? await countExportRows(db, userId, options) : 0,
    };
  }

  const limit = exportLimit(options.limit);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const tail = page[page.length - 1];

  return {
    rows: page.map(withoutTotal),
    nextCursor: hasMore && tail ? { occurredAt: tail.occurredAt, id: tail.id } : null,
    total: rowCount(rows[0].total),
  };
}

/** จำนวนแถวที่จะถูกส่งออก (ตาม scope) — **1 query** สำหรับ route ใช้ตอบ 4xx ก่อนเริ่มสร้างไฟล์ */
export async function countExportRows(
  db: Db,
  userId: string,
  options: { periodMonth?: PeriodMonth } = {},
): Promise<number> {
  const rows = await db
    .select({ total: sql<unknown>`count(*)` })
    .from(transactions)
    .where(and(...exportConditions(userId, options.periodMonth)));

  return rowCount(rows[0]?.total ?? 0);
}

/**
 * ตรวจเพดานก่อนสร้างไฟล์ — เกินแล้วโยน ValidationError ข้อความไทย (route แปลเป็น 4xx ให้ผู้ใช้)
 * ใช้ข้อความเดียวกันทั้ง CSV และ JSON สำรอง เพื่อไม่ให้ผู้ใช้เห็นสองเวอร์ชันของกติกาเดียวกัน
 */
export function assertExportWithinCap(total: number): void {
  if (total <= MAX_EXPORT_ROWS) return;
  const format = new Intl.NumberFormat('th-TH');
  throw new ValidationError(
    `ส่งออกได้ครั้งละไม่เกิน ${format.format(MAX_EXPORT_ROWS)} รายการ แต่ตอนนี้มี ${format.format(total)} รายการ — ` +
      'กรองตามเดือนแล้วลองใหม่ (หรือลบบางรายการที่ไม่ต้องการเก็บ)',
  );
}

/** แถวของ 3 ตารางที่ไม่ใช่รายการ — คัดเฉพาะคอลัมน์ที่สัญญาไฟล์สำรองระบุ (ไม่ปล่อยทั้งแถว DB ลงไฟล์) */

const backupAccountsQuery = (db: Db, userId: string) =>
  db
    .select({
      id: accounts.id,
      name: accounts.name,
      kind: accounts.kind,
      currency: accounts.currency,
      initialBalance: accounts.initialBalance,
      icon: accounts.icon,
      color: accounts.color,
      archivedAt: accounts.archivedAt,
      createdAt: accounts.createdAt,
    })
    .from(accounts)
    .where(eq(accounts.userId, userId))
    .orderBy(accounts.createdAt);

const backupCategoriesQuery = (db: Db, userId: string) =>
  db
    .select({
      id: categories.id,
      kind: categories.kind,
      name: categories.name,
      icon: categories.icon,
      color: categories.color,
      sortOrder: categories.sortOrder,
      archivedAt: categories.archivedAt,
      createdAt: categories.createdAt,
    })
    .from(categories)
    .where(eq(categories.userId, userId))
    .orderBy(categories.sortOrder, categories.name);

/** งบทุกเดือนของผู้ใช้ (ไม่ผูกกับงวดเดือนที่ส่งออก) — เรียงตามเดือนแล้วชื่อหมวดเพื่อให้ไฟล์เทียบกันได้ทุกครั้ง */
const backupBudgetsQuery = (db: Db, userId: string) =>
  db
    .select({
      id: budgets.id,
      categoryId: budgets.categoryId,
      periodMonth: budgets.periodMonth,
      amount: budgets.amount,
      currency: budgets.currency,
      createdAt: budgets.createdAt,
      updatedAt: budgets.updatedAt,
    })
    .from(budgets)
    .where(eq(budgets.userId, userId))
    .orderBy(budgets.periodMonth, budgets.createdAt);

/** จำนวนรายการที่ถูกลบแล้ว (ไม่ถูกส่งออก) — บอกผู้ใช้ตรง ๆ ในไฟล์สำรองว่าไฟล์ไม่รวมอะไร */
async function countDeletedTransactions(db: Db, userId: string): Promise<number> {
  const rows = await db
    .select({ total: sql<unknown>`count(*)` })
    .from(transactions)
    .where(and(eq(transactions.userId, userId), isNotNull(transactions.deletedAt)));

  return rowCount(rows[0]?.total ?? 0);
}

/**
 * ข้อมูลสำรองครบชุดของผู้ใช้ (ตามสเปก §1) — accounts/categories (รวมของที่ archive แล้ว) + budgets ทุกเดือน
 * + รายการที่ยังไม่ถูกลบทั้งหมด + counts (รวม `excludedDeleted`)
 *
 * เกินเพดาน → โยน ValidationError (ไม่คืน snapshot ที่ขาดรายการ เพราะไฟล์สำรองที่ขาดข้อมูลอันตรายกว่าไม่มีไฟล์)
 * การไล่หน้าใช้ keyset เดิม + เพดานต่อหน้า MAX_EXPORT_LIMIT · จำนวนรอบถูกล็อกด้วยเพดานรวม (กันลูปไม่จบถ้ามีบั๊ก)
 */
export async function buildBackupSnapshot(db: Db, userId: string): Promise<BackupData> {
  const total = await countExportRows(db, userId);
  assertExportWithinCap(total);

  const rows: ExportRow[] = [];
  let cursor: KeysetCursor | undefined;
  for (let page = 0; page <= Math.ceil(MAX_EXPORT_ROWS / MAX_EXPORT_LIMIT); page += 1) {
    const chunk = await exportTransactionRows(db, userId, { cursor, limit: MAX_EXPORT_LIMIT });
    rows.push(...chunk.rows);
    if (!chunk.nextCursor) break;
    cursor = chunk.nextCursor;
  }

  // เรียงคิวรีแบบลำดับ (ไม่ยิงพร้อมกัน): อ่านง่าย และ PGlite/Neon ต่อคำสั่งเดียวอยู่แล้ว
  const accountsRows: BackupAccount[] = await backupAccountsQuery(db, userId);
  const categoriesRows: BackupCategory[] = await backupCategoriesQuery(db, userId);
  const budgetsRows: BackupBudget[] = await backupBudgetsQuery(db, userId);
  const excludedDeleted = await countDeletedTransactions(db, userId);

  return {
    exportedAt: new Date().toISOString(),
    counts: {
      accounts: accountsRows.length,
      categories: categoriesRows.length,
      budgets: budgetsRows.length,
      transactions: rows.length,
      excludedDeleted,
    },
    accounts: accountsRows,
    categories: categoriesRows,
    budgets: budgetsRows,
    transactions: rows,
  };
}
