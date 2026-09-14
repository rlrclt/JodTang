/**
 * เทสต์ invariant ของเงิน "ทั้งชุด" — เขียนข้อมูลผ่าน mutation จริงแล้วตรวจความสอดคล้องข้ามทาง (PGlite)
 * รัน: node --test src/db/money-invariants.test.ts
 *
 * ทำไมต้องมี: เทสต์อื่นตรวจทีละฟังก์ชัน (validate / keyset / ยอดเดือน) แต่ไม่มีตัวไหนยืนยันว่า "ทุกทางที่คิดยอด
 * ให้ผลตรงกัน" ซึ่งเป็นคลาสบั๊กที่แพงที่สุดของแอปการเงิน · ที่นี่คำนวณยอดด้วย **ทางอิสระ** เสมอ:
 *   (ก) accountBalances() — union-all ต่อกระเป๋า + สูตรใน src/lib/money.ts
 *   (ข) SQL ตรง ๆ (sum(initial_balance) + income − expense) — ไม่ผ่านโค้ดที่เทสต์
 *   (ค) periodTotals(แถวจาก listTransactionPage) — ทางเดียวกับที่ UI ใช้
 *
 * invariant ที่ครอบ:
 *   1) โอนหักล้างกันพอดี (ผลรวมทุกกระเป๋าเท่าเดิม · ต้นทาง −, ปลายทาง +)
 *   2) ผลรวมกระเป๋า = ยอดรับ − ยอดจ่ายสะสม (ตรงกันทุกทาง เป็นสตางค์) + ไม่ปนของผู้ใช้อื่น
 *   3) ยอดเดือนของ monthTotals = ยอดของเดือนเดียวกับ listTransactionPage · โอนไม่ถูกนับเป็นรับ/จ่าย
 *   4) ขอบเขตเดือนตามเวลาไทย (+07) — 23:30 วันที่ 31 ต้องอยู่เดือนนั้น · 00:30 วันที่ 1 ต้องเป็นเดือนใหม่
 *   5) soft delete แล้ว invariant ยังจริง
 *   6) แก้รายการ (จำนวน/กระเป๋า/เดือน) แล้ว invariant ยังจริง
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

import { periodTotals } from '../lib/money.ts';
import type { Db } from './index.ts';
import { addAccount } from './mutations/accounts.ts';
import { addCategory } from './mutations/categories.ts';
import {
  addTransaction,
  softDeleteTransaction,
  updateTransaction,
} from './mutations/transactions.ts';
import { accountBalances } from './queries/accounts.ts';
import { listTransactionPage, monthTotals } from './queries/transactions.ts';
import * as schema from './schema.ts';

const DDL = readFileSync(new URL('../../docs/schema.sql', import.meta.url), 'utf8');

const U1 = 'inv-u1';
const U2 = 'inv-u2';
const SESSION_1 = { userId: U1 };
const SESSION_2 = { userId: U2 };
const SEPT = '2026-09-01';
const AUG = '2026-08-01';
/** ยอดตั้งต้นรวมของกระเป๋า u1 (100,000 + 0 − 50,000 สตางค์) — ใช้เป็นฐานของ invariant 2 */
const INITIAL_TOTAL = 100_000 + 0 - 50_000;
/** เพดานแถวที่เทสต์นี้ดึงมาตรวจ — ต้องมากกว่าจำนวนแถวใน fixture เสมอ (กันการเทียบสองทางที่ดึงมาไม่ครบ) */
const ROW_LIMIT = 200;

const pglite = new PGlite();
await pglite.exec(DDL);
await pglite.exec(`insert into "user" (id, name) values ('${U1}', 'Inv1'), ('${U2}', 'Inv2');`);

const db = drizzle(pglite, { schema }) as unknown as Db;

// ---- fixture: สร้างผ่าน mutation จริงเท่านั้น (validate + guardWrite + DDL ทำงานครบ) ----
const cash = await addAccount(db, SESSION_1, { name: 'เงินสด', kind: 'cash', initialBalance: 100_000 });
const bank = await addAccount(db, SESSION_1, { name: 'ธนาคาร', kind: 'bank', initialBalance: 0 });
const card = await addAccount(db, SESSION_1, { name: 'บัตรเครดิต', kind: 'credit', initialBalance: -50_000 });
const u2Cash = await addAccount(db, SESSION_2, { name: 'ของ u2', kind: 'cash', initialBalance: 0 });

const food = await addCategory(db, SESSION_1, { kind: 'expense', name: 'อาหาร' });
const salary = await addCategory(db, SESSION_1, { kind: 'income', name: 'เงินเดือน' });
const u2Food = await addCategory(db, SESSION_2, { kind: 'expense', name: 'อาหาร' });
const u2Salary = await addCategory(db, SESSION_2, { kind: 'income', name: 'เงินเดือน' });

await addTransaction(db, SESSION_1, {
  kind: 'income',
  amount: 2_000_000,
  accountId: cash.id,
  categoryId: salary.id,
  occurredAt: '2026-09-01T09:00:00+07:00',
  note: 'เงินเดือน ก.ย.',
});
await addTransaction(db, SESSION_1, {
  kind: 'expense',
  amount: 350_000,
  accountId: cash.id,
  categoryId: food.id,
  occurredAt: '2026-09-05T12:00:00+07:00',
  note: 'ข้าว',
});
await addTransaction(db, SESSION_1, {
  kind: 'expense',
  amount: 120_000,
  accountId: card.id,
  categoryId: food.id,
  occurredAt: '2026-09-06T12:00:00+07:00',
  note: 'มื้อเย็น',
});

// ---- ทางที่ใช้วัดยอด (อิสระต่อกัน) ----
const sum = (values: Iterable<number>) => [...values].reduce((total, value) => total + value, 0);

const balancesOf = (userId = U1) => accountBalances(db, userId);

/** ยอดรวมของทั้งบัญชี คิดจาก SQL ล้วน (ไม่ผ่านโค้ดที่เทสต์) */
const sqlTotal = async (userId = U1): Promise<number> => {
  const result = await pglite.query<{ total: string }>(`
    select (
      (select coalesce(sum(initial_balance), 0) from accounts     where user_id = '${userId}')
    + (select coalesce(sum(amount), 0)          from transactions where user_id = '${userId}' and deleted_at is null and kind = 'income')
    - (select coalesce(sum(amount), 0)          from transactions where user_id = '${userId}' and deleted_at is null and kind = 'expense')
    )::bigint as total`);
  return Number(result.rows[0].total);
};

/** ทุกแถวที่ยังไม่ถูกลบของผู้ใช้ (ทางเดียวกับ UI) — กันการเทียบที่ดึงมาไม่ครบ */
const allRows = async (userId = U1) => {
  const page = await listTransactionPage(db, userId, { limit: ROW_LIMIT });
  assert.ok(page.total <= ROW_LIMIT, `fixture ต้องไม่เกิน ${ROW_LIMIT} แถว (ได้ ${page.total})`);
  assert.equal(page.total, page.rows.length, 'ต้องดึงได้ครบทุกแถวในหน้าเดียว (ไม่มี cursor)');
  return page.rows;
};

/** ตรวจ invariant 2 (และฐานของ 1/3) พร้อมกัน — เรียกว่าหลังทุก mutation */
async function assertMoneyInvariants(where: string) {
  const balances = await balancesOf();
  const fromBalances = sum(balances.values());
  const fromSql = await sqlTotal();
  const { income, expense } = periodTotals(await allRows());

  assert.equal(fromBalances, fromSql, `${where}: ผลรวมกระเป๋าต้องเท่ากับ SQL ตรง ๆ`);
  assert.equal(
    fromBalances,
    INITIAL_TOTAL + income - expense,
    `${where}: ผลรวมกระเป๋า = ยอดตั้งต้น + รับสะสม − จ่ายสะสม`,
  );
  for (const value of balances.values()) {
    assert.ok(Number.isSafeInteger(value), `${where}: ยอดกระเป๋าต้องเป็นสตางค์จำนวนเต็ม`);
  }
  return balances;
}

test('1) โอนหักล้างกันพอดี: ผลรวมทุกกระเป๋าเท่าเดิม', async () => {
  const before = await balancesOf();
  const beforeTotal = sum(before.values());
  const beforeSept = await monthTotals(db, U1, SEPT);

  await addTransaction(db, SESSION_1, {
    kind: 'transfer',
    amount: 100_000,
    accountId: cash.id,
    toAccountId: bank.id,
    occurredAt: '2026-09-02T10:00:00+07:00',
    note: 'โอนเข้าแบงก์',
  });

  const after = await balancesOf();
  assert.equal(after.get(cash.id), (before.get(cash.id) ?? 0) - 100_000, 'ต้นทางต้องลด 100,000 สตางค์');
  assert.equal(after.get(bank.id), (before.get(bank.id) ?? 0) + 100_000, 'ปลายทางต้องเพิ่ม 100,000 สตางค์');
  assert.equal(sum(after.values()), beforeTotal, 'ผลรวมทุกกระเป๋าต้องเท่าเดิม (โอนไม่สร้าง/ทำลายเงิน)');

  // โอนไม่ถูกนับเป็นรับ/จ่าย → ยอดเดือนต้องไม่ขยับ
  assert.deepEqual(await monthTotals(db, U1, SEPT), beforeSept, 'โอนต้องไม่กระทบยอดรับ/จ่าย/คงเหลือของเดือน');

  await assertMoneyInvariants('หลังโอน');
});

test('2) ผลรวมกระเป๋า = ยอดรับ − ยอดจ่ายสะสม (สองทางอิสระ) และไม่ปนของผู้ใช้อื่น', async () => {
  const balances = await assertMoneyInvariants('ตั้งต้น');

  const rows = await allRows();
  const { income, expense } = periodTotals(rows);
  assert.equal(sum(balances.values()), INITIAL_TOTAL + income - expense);
  assert.equal(balances.size, 3, 'ต้องเห็นกระเป๋าทั้ง 3 ใบของ u1 (รวมใบที่ยอดติดลบ)');

  // u2 ทำรายการของตัวเอง → ตัวเลขของ u1 ต้องไม่ขยับเลย
  const beforeU1 = sum(balances.values());
  await addTransaction(db, SESSION_2, {
    kind: 'income',
    amount: 999_999,
    accountId: u2Cash.id,
    categoryId: u2Salary.id,
    occurredAt: '2026-09-03T10:00:00+07:00',
    note: 'ของ u2',
  });
  await addTransaction(db, SESSION_2, {
    kind: 'expense',
    amount: 111_111,
    accountId: u2Cash.id,
    categoryId: u2Food.id,
    occurredAt: '2026-09-04T10:00:00+07:00',
    note: 'ของ u2',
  });
  assert.equal(sum((await balancesOf()).values()), beforeU1, 'รายการของผู้ใช้อื่นต้องไม่กระทบยอดของ u1');
  assert.equal((await balancesOf(U2)).get(u2Cash.id), 999_999 - 111_111, 'u2 ต้องเห็นยอดของตัวเอง (รับ − จ่าย)');

  await assertMoneyInvariants('หลัง u2 เพิ่มรายการ');
});

test('3) ยอดเดือนเท่ากับที่ลิสต์ให้ UI และโอนไม่ถูกนับเป็นรับ/จ่าย', async () => {
  const page = await listTransactionPage(db, U1, { periodMonth: SEPT, limit: ROW_LIMIT });
  const rows = page.rows;

  assert.deepEqual(await monthTotals(db, U1, SEPT), periodTotals(rows), 'สองทางต้องตรงกันเป๊ะ');

  const transfers = rows.filter((row) => row.kind === 'transfer');
  assert.ok(transfers.length >= 1, 'fixture ต้องมีโอนในเดือนนี้ (ไม่งั้นเทสต์นี้พิสูจน์อะไรไม่ได้)');
  assert.deepEqual(
    periodTotals(rows),
    periodTotals(rows.filter((row) => row.kind !== 'transfer')),
    'โอนต้องไม่เปลี่ยนยอดรับ/จ่าย (ตัดออกแล้วผลเท่าเดิม)',
  );

  // ผลรวมของยอดทุกเดือน = ยอดสะสม (ไม่มีรายการไหนหลุดงวดเดือน)
  const months = await pglite.query<{ m: string }>(
    `select distinct occurred_month_bkk::text as m from transactions where user_id = '${U1}' and deleted_at is null order by 1`,
  );
  let accumulated = { income: 0, expense: 0 };
  for (const { m } of months.rows) {
    const totals = await monthTotals(db, U1, m);
    accumulated = { income: accumulated.income + totals.income, expense: accumulated.expense + totals.expense };
  }
  const all = periodTotals(await allRows());
  assert.deepEqual(accumulated, { income: all.income, expense: all.expense }, 'ผลรวมทุกงวดเดือนต้องเท่ายอดสะสม');
});

test('4) ขอบเขตเดือนตามเวลาไทย (+07): 23:30 วันที่ 31 อยู่เดือนเดิม · 00:30 วันที่ 1 ขึ้นเดือนใหม่', async () => {
  const lastNight = await addTransaction(db, SESSION_1, {
    kind: 'expense',
    amount: 1_100,
    accountId: cash.id,
    categoryId: food.id,
    occurredAt: '2026-08-31T23:30:00+07:00',
    note: 'ดึกสุดท้ายของ ส.ค.',
  });
  const firstMorning = await addTransaction(db, SESSION_1, {
    kind: 'expense',
    amount: 2_200,
    accountId: cash.id,
    categoryId: food.id,
    occurredAt: '2026-09-01T00:30:00+07:00',
    note: 'เช้ามืดวันที่ 1 ก.ย.',
  });

  // ค่าที่ DB generate เอง (แหล่งความจริงของงวดเดือน)
  const generated = await pglite.query<{ id: string; m: string }>(
    `select id, occurred_month_bkk::text as m from transactions where id in ('${lastNight.id}', '${firstMorning.id}')`,
  );
  const monthOf = new Map(generated.rows.map((row) => [row.id, row.m]));
  assert.equal(monthOf.get(lastNight.id), AUG, '23:30 ของ 31 ส.ค. (ไทย) ต้องเป็นงวดเดือน ส.ค.');
  assert.equal(monthOf.get(firstMorning.id), SEPT, '00:30 ของ 1 ก.ย. (ไทย) ต้องเป็นงวดเดือน ก.ย.');

  const aug = (await listTransactionPage(db, U1, { periodMonth: AUG, limit: ROW_LIMIT })).rows;
  assert.ok(aug.some((row) => row.id === lastNight.id), 'ต้องอยู่ในรายการเดือน ส.ค.');
  assert.ok(!aug.some((row) => row.id === firstMorning.id), 'ห้ามตกไปเดือน ส.ค.');

  const sept = (await listTransactionPage(db, U1, { periodMonth: SEPT, limit: ROW_LIMIT })).rows;
  assert.ok(sept.some((row) => row.id === firstMorning.id), 'ต้องอยู่ในรายการเดือน ก.ย.');
  assert.ok(!sept.some((row) => row.id === lastNight.id), 'ห้ามตกไปเดือน ก.ย.');

  await assertMoneyInvariants('หลังเพิ่มรายการขอบเดือน');
});

test('5) soft delete แล้ว invariant ยังจริง (ไม่ค้างเศษ)', async () => {
  const target = (await listTransactionPage(db, U1, { periodMonth: SEPT, limit: ROW_LIMIT })).rows.find(
    (row) => row.kind === 'expense',
  );
  assert.ok(target, 'ต้องมีรายจ่ายให้ลบ');

  const before = await balancesOf();
  const beforeSept = await monthTotals(db, U1, SEPT);
  await softDeleteTransaction(db, SESSION_1, target.id);

  const after = await balancesOf();
  assert.equal(
    after.get(target.accountId),
    (before.get(target.accountId) ?? 0) + target.amount,
    'ลบรายจ่าย = ยอดกระเป๋าต้องคืนกลับเท่ายอดนั้น',
  );
  const afterSept = await monthTotals(db, U1, SEPT);
  assert.equal(afterSept.expense, beforeSept.expense - target.amount, 'ยอดจ่ายของเดือนต้องลดลงเท่ายอดที่ลบ');
  assert.ok(
    !(await allRows()).some((row) => row.id === target.id),
    'แถวที่ลบแล้วต้องไม่อยู่ในลิสต์ที่ UI ใช้',
  );

  await assertMoneyInvariants('หลัง soft delete');
});

test('6) แก้รายการแล้ว invariant ยังจริง (จำนวน · กระเป๋า · ข้ามเดือน)', async () => {
  const row = (await listTransactionPage(db, U1, { periodMonth: SEPT, limit: ROW_LIMIT })).rows.find(
    (r) => r.kind === 'expense' && r.accountId === cash.id,
  );
  assert.ok(row, 'ต้องมีรายจ่ายของเงินสดให้แก้');

  // (ก) เพิ่มจำนวน
  const delta = 7_700;
  const beforeAmount = await balancesOf();
  const septBeforeAmount = await monthTotals(db, U1, SEPT);
  await updateTransaction(db, SESSION_1, row.id, { amount: row.amount + delta });
  const afterAmount = await balancesOf();
  assert.equal(afterAmount.get(cash.id), (beforeAmount.get(cash.id) ?? 0) - delta, 'เพิ่มยอดจ่าย = กระเป๋าลดตามส่วนต่าง');
  assert.equal((await monthTotals(db, U1, SEPT)).expense, septBeforeAmount.expense + delta, 'ยอดจ่ายเดือนเพิ่มตามส่วนต่าง');
  await assertMoneyInvariants('หลังแก้จำนวน');

  // (ข) ย้ายกระเป๋า
  const movedAmount = row.amount + delta;
  const beforeMove = await balancesOf();
  await updateTransaction(db, SESSION_1, row.id, { accountId: bank.id });
  const afterMove = await balancesOf();
  assert.equal(afterMove.get(cash.id), (beforeMove.get(cash.id) ?? 0) + movedAmount, 'กระเป๋าเดิมต้องได้ยอดคืน');
  assert.equal(afterMove.get(bank.id), (beforeMove.get(bank.id) ?? 0) - movedAmount, 'กระเป๋าใหม่ต้องถูกหัก');
  await assertMoneyInvariants('หลังย้ายกระเป๋า');

  // (ค) ย้ายเดือน (ก.ย. → ส.ค.)
  const septBefore = await monthTotals(db, U1, SEPT);
  const augBefore = await monthTotals(db, U1, AUG);
  await updateTransaction(db, SESSION_1, row.id, { occurredAt: '2026-08-15T10:00:00+07:00' });
  const septAfter = await monthTotals(db, U1, SEPT);
  const augAfter = await monthTotals(db, U1, AUG);
  assert.equal(septAfter.expense, septBefore.expense - movedAmount, 'เดือนเดิมต้องลดลง');
  assert.equal(augAfter.expense, augBefore.expense + movedAmount, 'เดือนใหม่ต้องเพิ่มขึ้น');
  assert.equal(
    septAfter.balance + augAfter.balance,
    septBefore.balance + augBefore.balance,
    'ผลรวมสองเดือนต้องเท่าเดิม (ย้ายเดือนไม่สร้าง/ทำลายเงิน)',
  );
  assert.ok(
    (await listTransactionPage(db, U1, { periodMonth: AUG, limit: ROW_LIMIT })).rows.some((r) => r.id === row.id),
    'หลังย้ายเดือนต้องอยู่ในลิสต์ของเดือนใหม่',
  );

  await assertMoneyInvariants('หลังย้ายเดือน');
});
