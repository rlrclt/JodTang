/**
 * อ่านกระเป๋าเงิน (accounts) — ชั้นอ่านเท่านั้น ไม่มีสูตรเงิน
 *
 * ต่างจาก transactions: ตารางนี้เลิกใช้ = archived_at (ไม่ใช่ deleted_at)
 * active = archived_at is null — ห้ามคัดลอก liveOf() ของ transactions มาทั้งดุ้น
 */
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';

import { accountBalance, satangFromDb } from '../../lib/money.ts';
import type { Db } from '../index.ts';
import { accounts, transactions } from '../schema.ts';

/** ชนิดกระเป๋าตาม check ของ DB (accounts_kind_check) */
export const ACCOUNT_KINDS = ['cash', 'bank', 'credit', 'ewallet', 'other'] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

/** คอลัมน์มาตรฐานของกระเป๋า — ใช้ร่วมกับ write path (src/db/mutations/accounts.ts) */
export const ACCOUNT_COLUMNS = {
  id: accounts.id,
  name: accounts.name,
  kind: accounts.kind,
  initialBalance: accounts.initialBalance,
  icon: accounts.icon,
  color: accounts.color,
  archivedAt: accounts.archivedAt,
};

export type AccountRow = {
  id: string;
  name: string;
  kind: string;
  initialBalance: number;
  icon: string | null;
  color: string | null;
  archivedAt: Date | null;
};

/** ตัวเลือกของ listAccounts — รูปแบบเดียวกับ ListCategoriesOptions ของหมวด (ไม่ส่ง = พฤติกรรมเดิม) */
export type ListAccountsOptions = {
  /** true = คืนกระเป๋าที่ archive แล้วด้วย (หน้าจัดการกระเป๋าต้องเห็นของที่เลิกใช้แล้ว) */
  includeArchived?: boolean;
};

/**
 * กระเป๋า เรียงตามลำดับที่สร้าง (ผู้ใช้เห็นลำดับเดิมทุกครั้ง)
 * `options.includeArchived` ไม่ส่ง = เฉพาะที่ยังใช้งาน (พฤติกรรมเดิมของผู้เรียกทุกราย) · ลำดับไม่เปลี่ยน
 */
export async function listAccounts(
  db: Db,
  userId: string,
  options: ListAccountsOptions = {},
): Promise<AccountRow[]> {
  const conditions = [eq(accounts.userId, userId)];
  if (!options.includeArchived) conditions.push(isNull(accounts.archivedAt));

  return db
    .select(ACCOUNT_COLUMNS)
    .from(accounts)
    .where(and(...conditions))
    .orderBy(asc(accounts.createdAt));
}

/**
 * ยอดคงเหลือของทุกกระเป๋าของผู้ใช้ — **1 query** (ไม่ใช่ query ต่อกระเป๋า)
 *
 * สูตร (นิยามเดียวกับ money.ts accountBalance — ที่นี่แค่ปั้นข้อมูลเข้าไปให้ตัวนั้นคิด):
 *   balance = initial_balance
 *           + income  ที่ account_id ตรง
 *           − expense ที่ account_id ตรง
 *           − transfer ที่ account_id ตรง (ต้นทาง) + transfer ที่ to_account_id ตรง (ปลายทาง)
 * รายการที่ soft delete แล้วไม่ถูกนับ · กระเป๋าที่ archive แล้วยังมียอดให้อ่าน (ประวัติยังอยู่)
 */
export async function accountBalances(db: Db, userId: string): Promise<Map<string, number>> {
  // กระแสเงินต่อกระเป๋า: แถวปกติ (รับ/จ่าย/โอนออก) นับที่ account_id · โอนเข้าเพิ่มอีกแถวที่ to_account_id
  const live = and(eq(transactions.userId, userId), isNull(transactions.deletedAt));
  const flow = db
    .select({ accountId: transactions.accountId, kind: transactions.kind, amount: transactions.amount })
    .from(transactions)
    .where(live)
    .unionAll(
      db
        .select({
          // ฝั่ง to_account_id เป็น nullable ในสคีมา แต่ถูกกรอง isNotNull ด้านล่างแล้ว → ระบุชนิดให้ตรงกับอีกฝั่งของ union
          accountId: sql<string>`${transactions.toAccountId}`,
          kind: sql<string>`'transfer_in'`,
          amount: transactions.amount,
        })
        .from(transactions)
        .where(and(live, isNotNull(transactions.toAccountId))),
    )
    .as('flow');

  const totals = db
    .select({
      accountId: flow.accountId,
      income: sql<unknown>`coalesce(sum(case when ${flow.kind} = 'income' then ${flow.amount} end), 0)`.as('income'),
      expense: sql<unknown>`coalesce(sum(case when ${flow.kind} = 'expense' then ${flow.amount} end), 0)`.as('expense'),
      transferIn: sql<unknown>`coalesce(sum(case when ${flow.kind} = 'transfer_in' then ${flow.amount} end), 0)`.as(
        'transfer_in',
      ),
      transferOut: sql<unknown>`coalesce(sum(case when ${flow.kind} = 'transfer' then ${flow.amount} end), 0)`.as(
        'transfer_out',
      ),
    })
    .from(flow)
    .groupBy(flow.accountId)
    .as('totals');

  const rows = await db
    .select({
      id: accounts.id,
      initialBalance: accounts.initialBalance,
      income: totals.income,
      expense: totals.expense,
      transferIn: totals.transferIn,
      transferOut: totals.transferOut,
    })
    .from(accounts)
    .leftJoin(totals, eq(totals.accountId, accounts.id))
    .where(eq(accounts.userId, userId));

  return new Map(
    rows.map((row): [string, number] => {
      // ปั้นเป็นแถวแบบ MoneyRow แล้วให้ money.ts คิด — สูตรเงินอยู่ที่เดียว ไม่กระจายมาอยู่ในชั้น query
      const synthetic = [
        { kind: 'income' as const, amount: satangFromDb(row.income, 'ยอดรับของกระเป๋า'), accountId: row.id },
        { kind: 'expense' as const, amount: satangFromDb(row.expense, 'ยอดจ่ายของกระเป๋า'), accountId: row.id },
        {
          kind: 'transfer' as const,
          amount: satangFromDb(row.transferOut, 'ยอดโอนออกของกระเป๋า'),
          accountId: row.id,
          toAccountId: null,
        },
        {
          kind: 'transfer' as const,
          amount: satangFromDb(row.transferIn, 'ยอดโอนเข้าของกระเป๋า'),
          accountId: '',
          toAccountId: row.id,
        },
      ];
      return [row.id, accountBalance(synthetic, row.id, row.initialBalance)];
    }),
  );
}

/**
 * กระเป๋าที่ผู้ใช้ "ใช้ล่าสุด" — ค่าเริ่มต้นของชีตบันทึกรายการ (โฟลว์ 2 แตะ) · **1 query**
 *
 * กติกาที่เลือกไว้ (คิดให้จบทั้งสองเคส):
 *   1. รายการล่าสุดเป็น **transfer** → คืน `account_id` (ต้นทาง) ไม่ใช่ `to_account_id`
 *      เหตุผล: `account_id` มีค่าเสมอทุก kind (ส่วน `to_account_id` เป็น null ยกเว้นโอน) → กติกาเดียวใช้ได้ทุกกรณี
 *      และตรงกับความหมาย "ใช้กระเป๋าใบนี้บันทึกรายการ" — ไม่ต้องมีกิ่งพิเศษในชั้นข้อมูล
 *   2. กระเป๋าที่ใช้ล่าสุดถูก **archive** แล้ว → **ข้ามไปใบก่อนหน้าที่ยังใช้งาน** (join กรอง `archived_at is null`)
 *      เหตุผล: UI ใช้ค่านี้เป็นค่าเริ่มต้นในชีต — ถ้าคืนใบที่ archive แล้ว ผู้ใช้กดบันทึกจะไม่ผ่าน (FK/ตัวเลือกไม่มีใบนั้น)
 *      ผู้ใช้ที่ไม่มีกระเป๋า active เหลือเลย = `null` (UI ต้องพาไปสร้างกระเป๋าก่อน)
 *
 * เรียง `occurred_at desc, id desc` (id เป็นตัวตัดสินเมื่อเวลาเท่ากัน) — ใช้ index `transactions_user_recent_idx`
 * ตัวเดียวกับที่เทสต์ EXPLAIN ยืนยันไว้ (ตรวจในเทสต์ของไฟล์นี้ด้วย) · รายการที่ soft delete แล้วไม่ถูกนับ
 */
export async function lastUsedAccountId(db: Db, userId: string): Promise<string | null> {
  const rows = await db
    .select({ accountId: transactions.accountId })
    .from(transactions)
    .innerJoin(
      accounts,
      and(
        eq(accounts.id, transactions.accountId),
        eq(accounts.userId, transactions.userId),
        isNull(accounts.archivedAt),
      ),
    )
    .where(and(eq(transactions.userId, userId), isNull(transactions.deletedAt)))
    .orderBy(desc(transactions.occurredAt), desc(transactions.id))
    .limit(1);

  return rows[0]?.accountId ?? null;
}

/**
 * จำนวน "รายการที่ยังไม่ถูกลบ" ที่อ้างถึงกระเป๋าแต่ละใบ — **1 query** (ไม่ใช่ query ต่อใบ)
 * นับทั้งฝั่งต้นทาง (account_id) และปลายทางของโอน (to_account_id) โดยนับรายการไม่ซ้ำ
 * คืนเฉพาะ id ที่มีอย่างน้อย 1 รายการ (ผู้เรียกอ่าน `usage.get(id) ?? 0`) · ids ว่าง = ไม่ยิง DB
 */
export async function accountUsage(
  db: Db,
  userId: string,
  ids: readonly string[],
): Promise<Map<string, number>> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return new Map();

  const live = and(eq(transactions.userId, userId), isNull(transactions.deletedAt));
  const refs = db
    .select({ accountId: transactions.accountId, txnId: transactions.id })
    .from(transactions)
    .where(and(live, inArray(transactions.accountId, wanted)))
    .unionAll(
      db
        .select({
          // nullable ในสคีมา แต่กรองด้วย inArray ด้านบนแล้ว → ชนิดต้องตรงกับอีกฝั่งของ union
          accountId: sql<string>`${transactions.toAccountId}`,
          txnId: transactions.id,
        })
        .from(transactions)
        .where(and(live, inArray(transactions.toAccountId, wanted))),
    )
    .as('refs');

  const rows = await db
    .select({ accountId: refs.accountId, total: sql<unknown>`count(distinct ${refs.txnId})::int` })
    .from(refs)
    .groupBy(refs.accountId);

  const usage = new Map<string, number>();
  for (const row of rows) {
    if (row.accountId !== null) usage.set(row.accountId, Number(row.total));
  }
  return usage;
}
