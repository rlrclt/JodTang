/**
 * Write path ของงบประมาณ (budgets) — คู่กับ src/db/queries/budgets.ts
 *
 * กติกาของไฟล์นี้:
 *   1. "ตั้งงบ" กับ "แก้งบ" เป็น action เดียว (upsert) เพราะ unique (user_id, category_id, period_month)
 *      → ผู้ใช้กดบันทึกซ้ำเดือนเดิมต้องได้แถวเดิม ไม่ใช่ 23505 (schema.sql:266)
 *   2. userId มาจาก session เท่านั้น (พารามิเตอร์) ห้ามรับจาก input
 *   3. หมวดต้องเป็นของผู้ใช้คนนี้ + kind='expense' + ยังไม่ archive — DDL บังคับไม่ได้ (schema.sql:271-273) จึงบังคับที่นี่
 *      ตรวจด้วย 1 SELECT ที่คืนทั้ง kind และ archived_at (ข้อความผิดพลาดตรงสาเหตุจริง บอกผู้ใช้ได้)
 *   4. ทุก write ห่อ guardWrite → 23505/23503/23514 ออกเป็นข้อความไทย ไม่ใช่ error ดิบของ DB
 *   5. ลบงบ = DELETE จริง (ตารางนี้ไม่มี deleted_at/archived_at — งบคือ "แผน" ไม่ใช่ ledger)
 */
import { and, eq } from 'drizzle-orm';

import { toSatang } from '../../lib/money.ts';
import type { PeriodMonth } from '../../lib/month.ts';
import { guardWrite, ValidationError } from '../errors.ts';
import type { Db } from '../index.ts';
import { BUDGET_COLUMNS, type BudgetRow } from '../queries/budgets.ts';
import { budgets, categories } from '../schema.ts';
import type { Session } from '../session.ts';

/** ฟิลด์ที่ยอมรับจาก input — ที่เหลือ (userId, id, currency, …) ระบบกำหนดเอง = ปฏิเสธ */
const ALLOWED_KEYS: readonly string[] = ['categoryId', 'periodMonth', 'amount'];
/** เพดานเดียวกับ schema.sql (budgets_amount_check: amount > 0 and amount < 1e15) */
const MAX_SATANG = 1_000_000_000_000_000;
const CURRENCY = 'THB';

/** uuid มาตรฐาน (8-4-4-4-12) — ตรวจก่อนถึง DB เพื่อไม่ให้ 22P02 ดิบ ๆ ถึงผู้ใช้ */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** งวดเดือนคือวันแรกของเดือนเท่านั้น (ตรงกับ budgets_period_month_ck ฝั่ง DB) */
const PERIOD_MONTH_RE = /^(\d{4})-(\d{2})-01$/;

export type ValidBudget = {
  categoryId: string;
  periodMonth: PeriodMonth;
  /** สตางค์ จำนวนเต็ม 1..999999999999999 */
  amount: number;
};

function requiredUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw new ValidationError(`${field}ไม่ถูกต้อง`);
  return value;
}

function requiredPeriodMonth(value: unknown): PeriodMonth {
  const match = typeof value === 'string' ? PERIOD_MONTH_RE.exec(value) : null;
  const month = match ? Number(match[2]) : 0;
  if (!match || month < 1 || month > 12) {
    throw new ValidationError('งวดเดือนต้องเป็นวันแรกของเดือน (YYYY-MM-01)');
  }
  return value as string;
}

/** ตรวจกติกาทั้งชุดของงบหนึ่งแถว (โยน ValidationError เสมอเมื่อไม่ผ่าน เพื่อให้ผู้เรียกแยกจาก error ของ DB) */
export function validateBudget(input: unknown): ValidBudget {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ValidationError('ข้อมูลงบประมาณต้องเป็น object');
  }
  const raw = input as Record<string, unknown>;

  for (const key of Object.keys(raw)) {
    if (!ALLOWED_KEYS.includes(key)) {
      throw new ValidationError(`ไม่อนุญาตให้ส่งฟิลด์ ${key} จาก input`);
    }
  }

  const categoryId = requiredUuid(raw.categoryId, 'รหัสหมวด');
  const periodMonth = requiredPeriodMonth(raw.periodMonth);

  let amount: number;
  try {
    amount = toSatang(raw.amount, 'จำนวนเงิน');
  } catch (error) {
    throw new ValidationError((error as Error).message);
  }
  if (amount <= 0) throw new ValidationError('จำนวนเงินต้องมากกว่า 0');
  if (amount >= MAX_SATANG) throw new ValidationError('จำนวนเงินเกินเพดานที่ระบบรองรับ');

  return { categoryId, periodMonth, amount };
}

/**
 * ตั้งงบ (หรือทับของเดิมถ้ามีอยู่แล้ว) — userId มาจาก session ไม่ใช่จาก input
 * ตรวจหมวดก่อน 1 SELECT เพื่อให้ข้อความบอกได้ว่า "ไม่ใช่ของคุณ / ไม่ใช่หมวดรายจ่าย / เลิกใช้แล้ว"
 */
export async function setBudget(db: Db, session: Session, input: unknown): Promise<BudgetRow> {
  const data = validateBudget(input);

  const owned = await guardWrite(() =>
    db
      .select({ kind: categories.kind, archivedAt: categories.archivedAt })
      .from(categories)
      .where(and(eq(categories.id, data.categoryId), eq(categories.userId, session.userId))),
  );
  if (owned.length === 0) throw new ValidationError('ไม่พบหมวดนี้ (หรือไม่ใช่ของคุณ)');
  if (owned[0].kind !== 'expense') throw new ValidationError('ตั้งงบได้เฉพาะหมวดรายจ่าย');
  if (owned[0].archivedAt !== null) throw new ValidationError('หมวดนี้เลิกใช้แล้ว — ตั้งงบใหม่ไม่ได้');

  const rows = await guardWrite(() =>
    db
      .insert(budgets)
      .values({
        userId: session.userId,
        categoryId: data.categoryId,
        periodMonth: data.periodMonth,
        amount: data.amount,
        currency: CURRENCY,
      })
      .onConflictDoUpdate({
        target: [budgets.userId, budgets.categoryId, budgets.periodMonth],
        set: { amount: data.amount },
      })
      .returning(BUDGET_COLUMNS),
  );

  return rows[0];
}

/** ลบงบ = DELETE จริง ของผู้ใช้คนนี้เท่านั้น (ลบของคนอื่น = ไม่พบงบ ไม่ใช่เงียบ ๆ สำเร็จ) */
export async function deleteBudget(
  db: Db,
  session: Session,
  budgetId: string,
): Promise<{ id: string }> {
  const rowId = requiredUuid(budgetId, 'รหัสงบ');

  const rows = await guardWrite(() =>
    db
      .delete(budgets)
      .where(and(eq(budgets.id, rowId), eq(budgets.userId, session.userId)))
      .returning({ id: budgets.id }),
  );

  if (rows.length === 0) throw new ValidationError('ไม่พบงบนี้ (หรือไม่ใช่ของคุณ)');
  return rows[0];
}
