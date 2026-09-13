/**
 * อ่านงบประมาณต่อเดือนต่อหมวด (budgets) — คู่กับ src/db/mutations/budgets.ts
 *
 * กติกาของไฟล์นี้:
 *   1. `used` ต้องเท่ากับผลของ monthExpenseByCategory() (src/db/queries/transactions.ts) เป๊ะ — ตัวเลขต้องตรงกันทั้งแอป
 *      ไม่คิดสูตรเงินใหม่ในไฟล์นี้: ผลรวมมาจาก SQL แล้วส่งเข้า satangFromDb() ของ src/lib/money.ts (ด่านเดียวของจำนวนเงิน)
 *   2. งบของหมวดที่ถูก archive ยังต้องอ่านออกมา (พร้อม archivedAt) — ถ้าซ่อน หน้า /summary จะขาดยอดเงียบ ๆ
 *   3. หน้าเดียว = query เดียว (ห้าม N+1: งบ N หมวดต้องไม่ยิง N+1 ครั้ง) — เทสต์นับ query จริงไว้ที่ budgets.test.ts
 *   4. relative import + .ts ต่อท้าย เพราะเทสต์รันด้วย `node --test` ตรง ๆ ซึ่งไม่รู้จัก alias @/
 */
import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import { satangFromDb } from '../../lib/money.ts';
import type { PeriodMonth } from '../../lib/month.ts';
import type { Db } from '../index.ts';
import { budgets, categories, transactions } from '../schema.ts';

/** คอลัมน์มาตรฐานของงบ — ใช้ร่วมกับ write path (src/db/mutations/budgets.ts) */
export const BUDGET_COLUMNS = {
  id: budgets.id,
  categoryId: budgets.categoryId,
  periodMonth: budgets.periodMonth,
  amount: budgets.amount,
  createdAt: budgets.createdAt,
  updatedAt: budgets.updatedAt,
};

export type BudgetRow = {
  id: string;
  categoryId: string;
  /** 'YYYY-MM-01' ของเดือนไทย (ดู src/lib/month.ts) */
  periodMonth: string;
  /** งบเป็นสตางค์ (bigint) */
  amount: number;
  createdAt: Date;
  updatedAt: Date;
};

/** งบ 1 แถว + สถานะที่หน้าจอต้องใช้ (ยอดที่ใช้ไปของเดือนนั้น + ข้อมูลหมวด) */
export type BudgetProgress = {
  budgetId: string;
  categoryId: string;
  categoryName: string;
  categoryIcon: string | null;
  categoryColor: string | null;
  /** ไม่ null = หมวดเลิกใช้แล้ว → UI ติดป้าย "เลิกใช้แล้ว" (ยังคิดยอดและล้างงบได้) */
  categoryArchivedAt: Date | null;
  periodMonth: PeriodMonth;
  /** งบที่ตั้งไว้ (สตางค์) */
  amount: number;
  /** ผลรวม expense ของเดือนนั้นของหมวดนั้น (สตางค์) — เท่ากับ monthExpenseByCategory() */
  used: number;
};

/**
 * งบของเดือนหนึ่ง + ยอดที่ใช้ไปแล้วของแต่ละหมวด — 1 query ต่อหน้า
 * budgets ⋈ categories(id, user_id) ⟕ ผลรวม expense ของเดือนนั้น (group by category_id)
 * เรียง: หมวดที่ยังใช้อยู่ก่อน แล้วค่อย sort_order, name (แบบเดียวกับ listCategories)
 */
export async function listBudgetProgress(
  db: Db,
  userId: string,
  periodMonth: PeriodMonth,
): Promise<BudgetProgress[]> {
  const monthSpend = db
    .select({
      categoryId: transactions.categoryId,
      used: sql<string>`sum(${transactions.amount})`.as('used'),
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.occurredMonthBkk, periodMonth),
        eq(transactions.kind, 'expense'),
        isNull(transactions.deletedAt),
      ),
    )
    .groupBy(transactions.categoryId)
    .as('month_spend');

  const rows = await db
    .select({
      budgetId: budgets.id,
      categoryId: budgets.categoryId,
      categoryName: categories.name,
      categoryIcon: categories.icon,
      categoryColor: categories.color,
      categoryArchivedAt: categories.archivedAt,
      periodMonth: budgets.periodMonth,
      amount: budgets.amount,
      used: sql<unknown>`coalesce(${monthSpend.used}, 0)`,
    })
    .from(budgets)
    .innerJoin(
      categories,
      and(eq(categories.id, budgets.categoryId), eq(categories.userId, budgets.userId)),
    )
    .leftJoin(monthSpend, eq(monthSpend.categoryId, budgets.categoryId))
    .where(and(eq(budgets.userId, userId), eq(budgets.periodMonth, periodMonth)))
    // boolean ขึ้นก่อนได้: false < true → แถวที่ archived_at is null มาก่อน
    .orderBy(sql`${categories.archivedAt} is not null`, asc(categories.sortOrder), asc(categories.name));

  return rows.map((row) => ({ ...row, used: satangFromDb(row.used, 'ยอดที่ใช้ไปของหมวด') }));
}

/** งบของ (ผู้ใช้, หมวด, เดือน) — ใช้ตอนเปิด sheet ว่าตั้งไว้เท่าไร · ไม่มี = null */
export async function getBudget(
  db: Db,
  userId: string,
  categoryId: string,
  periodMonth: PeriodMonth,
): Promise<BudgetRow | null> {
  const rows = await db
    .select(BUDGET_COLUMNS)
    .from(budgets)
    .where(
      and(
        eq(budgets.userId, userId),
        eq(budgets.categoryId, categoryId),
        eq(budgets.periodMonth, periodMonth),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}
