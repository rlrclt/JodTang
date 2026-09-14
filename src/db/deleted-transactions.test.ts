/**
 * เทสต์ "รายการที่ลบแล้ว + กู้คืน" (ถังขยะ) — PGlite + mutation/query จริง
 * รัน: node --test src/db/deleted-transactions.test.ts
 *
 * ครอบ:
 *   - ลบแล้วหายจากลิสต์ปกติ ไปอยู่ในลิสต์ที่ลบแล้ว (พร้อม deletedAt ต่อแถว)
 *   - keyset ของถังขยะไล่ครบ ไม่ซ้ำ/ไม่ขาด · total นิ่งทุกหน้า · เรียง "ล่าสุดที่ลบก่อน"
 *   - กู้คืน → กลับมาลิสต์ปกติ และยอดทุกทางกลับมาเท่าเดิม (monthTotals + accountBalances)
 *   - กู้คืนซ้ำ / กู้ของคนอื่น → ValidationError
 *   - กฎ: ห้ามกู้คืนถ้ากระเป๋า/หมวดถูก archive ไปแล้ว (ข้อความบอกทางแก้) ตามคอมเมนต์ใน restoreTransaction
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

import { ValidationError } from './errors.ts';
import type { Db } from './index.ts';
import { addAccount, archiveAccount, restoreAccount } from './mutations/accounts.ts';
import { addCategory, archiveCategory, restoreCategory } from './mutations/categories.ts';
import {
  addTransaction,
  restoreTransaction,
  softDeleteTransaction,
} from './mutations/transactions.ts';
import { accountBalances } from './queries/accounts.ts';
import {
  deletedTransactionsQuery,
  listDeletedTransactions,
  listTransactionPage,
  monthTotals,
} from './queries/transactions.ts';
import * as schema from './schema.ts';

const DDL = readFileSync(new URL('../../docs/schema.sql', import.meta.url), 'utf8');

const U1 = 'del-u1';
const U2 = 'del-u2';
const SESSION_1 = { userId: U1 };
const SESSION_2 = { userId: U2 };
const SEPT = '2026-09-01';

const pglite = new PGlite();
await pglite.exec(DDL);
await pglite.exec(`insert into "user" (id, name) values ('${U1}', 'Del1'), ('${U2}', 'Del2');`);

const db = drizzle(pglite, { schema }) as unknown as Db;

const cash = await addAccount(db, SESSION_1, { name: 'เงินสด', kind: 'cash', initialBalance: 100_000 });
const bank = await addAccount(db, SESSION_1, { name: 'ธนาคาร', kind: 'bank', initialBalance: 0 });
const food = await addCategory(db, SESSION_1, { kind: 'expense', name: 'อาหาร' });
const u2Cash = await addAccount(db, SESSION_2, { name: 'ของ u2', kind: 'cash', initialBalance: 0 });
const u2Food = await addCategory(db, SESSION_2, { kind: 'expense', name: 'ของ u2' });

const sum = (values: Iterable<number>) => [...values].reduce((total, value) => total + value, 0);
const liveTotal = async () => (await listTransactionPage(db, U1, { limit: 100 })).total;

const makeExpense = (amount: number, note: string, accountId = cash.id) =>
  addTransaction(db, SESSION_1, {
    kind: 'expense',
    amount,
    accountId,
    categoryId: food.id,
    occurredAt: `2026-09-${String(1 + (amount % 27)).padStart(2, '0')}T10:00:00+07:00`,
    note,
  });

test('ลบแล้ว: หายจากลิสต์ปกติ · ไปอยู่ถังขยะพร้อม deletedAt · ยอดสะสมลดลง', async () => {
  const target = await makeExpense(11_000, 'จะถูกลบ');
  const before = await accountBalances(db, U1); // ยอด "หลังสร้าง" — รายจ่ายนี้นับอยู่ในยอดแล้ว
  const liveBefore = await liveTotal();

  await softDeleteTransaction(db, SESSION_1, target.id);

  const trash = await listDeletedTransactions(db, U1, { limit: 50 });
  assert.equal(trash.total, 1, 'ถังขยะต้องมี 1 แถว');
  assert.equal(trash.rows[0].id, target.id);
  assert.ok(trash.rows[0].deletedAt instanceof Date, 'ต้องคืน deletedAt ต่อแถว (ชนิด DeletedTxn)');
  assert.equal(trash.nextCursor, null);

  const live = await listTransactionPage(db, U1, { limit: 100 });
  assert.ok(!live.rows.some((row) => row.id === target.id), 'แถวที่ลบต้องไม่อยู่ในลิสต์ปกติ');
  assert.equal(live.total, liveBefore - 1);

  // ยอดกระเป๋าต้องคืนกลับเท่ายอดที่ลบ (ลบรายจ่าย = เงินกลับเข้ากระเป๋า)
  const after = await accountBalances(db, U1);
  assert.equal(after.get(cash.id), (before.get(cash.id) ?? 0) + 11_000, 'ลบรายจ่าย = เงินกลับเข้ากระเป๋า');
  assert.equal(
    sum(after.values()),
    sum(before.values()) + 11_000,
    'ลบรายจ่าย = ยอดรวมเพิ่มขึ้นเท่ายอดนั้น (รายจ่ายหลุดออกจากยอด ไม่ใช่เงินหาย)',
  );
});

test('keyset ถังขยะ: ไล่ครบ ไม่ซ้ำ/ไม่ขาด · total นิ่ง · เรียงล่าสุดที่ลบก่อน + ข้ามผู้ใช้', async () => {
  // ลบเพิ่มหลายแถว (ลำดับการลบต่างกัน) — fixture ต้องมี ≥5 แถวในถังขยะ
  for (const amount of [1_200, 2_300, 3_400]) {
    const row = await makeExpense(amount, `ลบทีหลัง ${amount}`, bank.id);
    await softDeleteTransaction(db, SESSION_1, row.id);
  }
  // ของ u2 ลบเหมือนกัน → ต้องไม่โผล่ในถังขยะของ u1
  const u2Row = await addTransaction(db, SESSION_2, {
    kind: 'expense',
    amount: 9_999,
    accountId: u2Cash.id,
    categoryId: u2Food.id,
    occurredAt: '2026-09-09T10:00:00+07:00',
    note: 'ของ u2',
  });
  await softDeleteTransaction(db, SESSION_2, u2Row.id);

  const expected = (await listDeletedTransactions(db, U1, { limit: 100 })).total;
  assert.ok(expected >= 4, `ถังขยะต้องมีอย่างน้อย 4 แถว (ได้ ${expected})`);

  const seen: string[] = [];
  let cursor: { deletedAt: Date; id: string } | undefined;
  for (let guard = 0; guard < 20; guard += 1) {
    const page = await listDeletedTransactions(db, U1, { limit: 2, ...(cursor ? { cursor } : {}) });
    assert.equal(page.total, expected, 'total ต้องเท่ากันทุกหน้า');
    if (page.rows.length === 0) break;
    seen.push(...page.rows.map((row) => row.id));
    cursor = page.nextCursor ?? undefined;
    if (!cursor) break;
  }
  assert.equal(seen.length, expected, 'ต้องไล่ได้ครบทุกแถวในถังขยะ');
  assert.equal(new Set(seen).size, expected, 'ต้องไม่มี id ซ้ำข้ามหน้า');

  // เรียงตาม "เวลาที่ลบ" จากใหม่ → เก่า (ไม่ใช่ occurred_at)
  const all = (await listDeletedTransactions(db, U1, { limit: 100 })).rows;
  for (let index = 1; index < all.length; index += 1) {
    const prev = all[index - 1].deletedAt.getTime();
    const next = all[index].deletedAt.getTime();
    assert.ok(prev >= next, `ลำดับต้องเป็น deleted_at desc (แถว ${index})`);
  }

  assert.equal((await listDeletedTransactions(db, U2, { limit: 100 })).total, 1, 'u2 เห็นเฉพาะของตัวเอง');
});

test('กู้คืน: กลับมาลิสต์ปกติ + ยอดเดือน/กระเป๋ากลับมาเท่าเดิม', async () => {
  const row = await makeExpense(7_700, 'ลบแล้วกู้คืน');
  const septBefore = await monthTotals(db, U1, SEPT);
  const balancesBefore = await accountBalances(db, U1);
  const liveBefore = await liveTotal();

  await softDeleteTransaction(db, SESSION_1, row.id);
  assert.equal((await monthTotals(db, U1, SEPT)).expense, septBefore.expense - 7_700, 'ลบแล้วยอดจ่ายเดือนลด');

  const restored = await restoreTransaction(db, SESSION_1, row.id);
  assert.equal(restored.id, row.id);
  assert.equal(restored.amount, 7_700);
  assert.equal(restored.deletedAt, null);

  assert.deepEqual(await monthTotals(db, U1, SEPT), septBefore, 'ยอดเดือนต้องกลับมาเท่าเดิมเป๊ะ');
  assert.deepEqual(await accountBalances(db, U1), balancesBefore, 'ยอดกระเป๋าต้องกลับมาเท่าเดิม');
  assert.equal(await liveTotal(), liveBefore, 'กลับเข้าลิสต์ปกติ (จำนวนเท่ากับก่อนลบ)');
  assert.ok(
    !(await listDeletedTransactions(db, U1, { limit: 100 })).rows.some((item) => item.id === row.id),
    'ต้องหายจากถังขยะ',
  );
});

test('กู้คืนซ้ำ / กู้ของคนอื่น / id ไม่มีจริง → ValidationError ข้อความไทย', async () => {
  const row = await makeExpense(15_000, 'กู้ซ้ำ');
  await softDeleteTransaction(db, SESSION_1, row.id);
  await restoreTransaction(db, SESSION_1, row.id);

  // กู้ซ้ำ (แถวนี้กลับมาใช้งานแล้ว → ต้องไม่ใช่ no-op เงียบ ๆ)
  await assert.rejects(
    () => restoreTransaction(db, SESSION_1, row.id),
    (error: unknown) => error instanceof ValidationError && /ไม่ได้ถูกลบ/.test(error.message),
  );

  // ของผู้ใช้คนอื่น (แถวที่ยังไม่ถูกลบของ u2 ก็ต้องไม่กู้ได้)
  const u2Live = await addTransaction(db, SESSION_2, {
    kind: 'expense',
    amount: 500,
    accountId: u2Cash.id,
    categoryId: u2Food.id,
    occurredAt: '2026-09-10T10:00:00+07:00',
  });
  await assert.rejects(() => restoreTransaction(db, SESSION_1, u2Live.id), ValidationError);

  // id ที่ไม่มีในตาราง
  await assert.rejects(
    () => restoreTransaction(db, SESSION_1, '99999999-9999-9999-9999-999999999999'),
    (error: unknown) => error instanceof ValidationError && /ไม่พบรายการนี้/.test(error.message),
  );
});

test('กู้คืนไม่ได้ถ้ากระเป๋า/หมวดถูก archive — ข้อความบอกทางแก้ · กู้คืนของที่ archive แล้วได้', async () => {
  // (ก) กระเป๋าถูก archive
  const rowAccount = await makeExpense(4_200, 'กระเป๋า archive', bank.id);
  await softDeleteTransaction(db, SESSION_1, rowAccount.id);
  await archiveAccount(db, SESSION_1, bank.id);

  await assert.rejects(
    () => restoreTransaction(db, SESSION_1, rowAccount.id),
    (error: unknown) => error instanceof ValidationError && /กระเป๋าของรายการนี้ถูกเลิกใช้แล้ว/.test(error.message),
  );
  assert.ok(
    (await listDeletedTransactions(db, U1, { limit: 100 })).rows.some((row) => row.id === rowAccount.id),
    'ไม่สำเร็จ = ต้องยังอยู่ในถังขยะ',
  );

  // กู้คืนกระเป๋าก่อน → กู้รายการได้
  await restoreAccount(db, SESSION_1, bank.id);
  assert.equal((await restoreTransaction(db, SESSION_1, rowAccount.id)).id, rowAccount.id);

  // (ข) หมวดถูก archive
  const rowCategory = await makeExpense(5_300, 'หมวด archive');
  await softDeleteTransaction(db, SESSION_1, rowCategory.id);
  await archiveCategory(db, SESSION_1, food.id);

  await assert.rejects(
    () => restoreTransaction(db, SESSION_1, rowCategory.id),
    (error: unknown) => error instanceof ValidationError && /หมวดของรายการนี้ถูกเลิกใช้แล้ว/.test(error.message),
  );

  await restoreCategory(db, SESSION_1, food.id);
  assert.equal((await restoreTransaction(db, SESSION_1, rowCategory.id)).id, rowCategory.id);
});

test('1 query ต่อการเรียก (listDeletedTransactions · restoreTransaction)', async () => {
  let queries = 0;
  const runQuery = pglite.query.bind(pglite);
  pglite.query = ((...args: Parameters<typeof runQuery>) => {
    queries += 1;
    return runQuery(...args);
  }) as typeof pglite.query;

  queries = 0;
  await listDeletedTransactions(db, U1, { limit: 5 });
  assert.equal(queries, 1, 'ถังขยะ 1 หน้า = 1 query');

  const row = await makeExpense(600, 'นับ query');
  await softDeleteTransaction(db, SESSION_1, row.id);
  queries = 0;
  await restoreTransaction(db, SESSION_1, row.id);
  assert.equal(queries, 2, 'กู้คืน = อ่านสถานะ 1 + update 1');

  pglite.query = runQuery as typeof pglite.query;
});

test('ลิสต์ที่ลบแล้วใช้ index transactions_user_deleted_idx (ไม่ตกเป็น Seq Scan)', async () => {
  // ตารางเล็กในเทสต์ → planner เลือก seq scan ได้อย่างถูกต้อง · ปิด seqscan เพื่อยืนยันว่า "index นี้ใช้กับ query นี้ได้จริง"
  await pglite.exec('set enable_seqscan = off');
  const built = deletedTransactionsQuery(db, U1, { limit: 20 }).toSQL();
  const plan = (
    await pglite.query<{ 'QUERY PLAN': string }>(`explain (costs off) ${built.sql}`, built.params as never[])
  ).rows
    .map((row) => row['QUERY PLAN'])
    .join('\n');
  await pglite.exec('set enable_seqscan = on');

  assert.match(plan, /transactions_user_deleted_idx/, `ต้องใช้ index ของถังขยะ:\n${plan}`);
  assert.doesNotMatch(plan, /Seq Scan/, `ต้องไม่ตกเป็น Seq Scan:\n${plan}`);
  // หมายเหตุ: ตารางเล็กในเทสต์ planner เลือก Bitmap Index Scan + Sort ได้ (ยังใช้ index เดียวกัน) —
  // การที่ index นี้ "เรียงให้เลย ไม่ต้อง Sort" วัดยืนยันบนข้อมูล 22k แถวแล้ว (ดูรายงาน wave21)
});
