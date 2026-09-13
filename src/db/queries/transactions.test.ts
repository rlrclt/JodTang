/**
 * เทสต์ query layer กับ Postgres จริง — PGlite (devDependency ในเรป ไม่ต้องต่อ Neon)
 * รัน: node --test src/db/queries/transactions.test.ts
 *
 * apply DDL จาก docs/schema.sql ตรง ๆ (แหล่งความจริง) ไม่ใช่สำเนา
 * พิสูจน์ 4 ข้อตามเกณฑ์รับ:
 *   ก) ยอดที่ query คืน = ค่าที่คิดมือ + = periodTotals() ของแถวชุดเดียวกัน (สูตรเงินอยู่ money.ts ที่เดียว)
 *   ข) ไม่มีแถว/ยอดข้ามผู้ใช้หลุด (u2 มีรายการก้อนใหญ่ที่ต้องไม่โผล่ในยอดของ u1)
 *   ค) แถว soft delete ไม่ถูกนับ (และยืนยันว่าแถวนั้นมีอยู่จริงใน DB — เทสต์จะได้ไม่ผ่านแบบหลอก ๆ)
 *   ง) query หน้าแรกใช้ index transactions_user_recent_idx และไม่ต้อง Sort
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

import { periodTotals } from '../../lib/money.ts';
import type { Db } from '../index.ts';
import * as schema from '../schema.ts';
import {
  listTransactions,
  monthExpenseByCategory,
  monthRows,
  monthTotals,
  recentTransactions,
  recentTransactionsQuery,
} from './transactions.ts';

const DDL = readFileSync(new URL('../../../docs/schema.sql', import.meta.url), 'utf8');

const U1 = 'u1';
const U2 = 'u2';
const A1 = '11111111-1111-1111-1111-111111111111';
const A2 = '22222222-2222-2222-2222-222222222222';
const A_U2 = '33333333-3333-3333-3333-333333333333';
const C = (n: number) => `10000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const [C_FOOD, C_TRAVEL, C_RENT, C_SUPPLY, C_UTIL, C_COFFEE, C_SALARY, C_SALES, C_U2E, C_U2I] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(C);

const SEPT = '2026-09-01';
const AUG = '2026-08-01';
// ยอดที่ต้องได้ของ u1 เดือน ก.ย. (คิดมือไว้ล่วงหน้า ไม่ได้ derive จากโค้ดที่จะเทสต์)
const SEPT_INCOME = 2_450_000; // 2,250,000 + 200,000
const SEPT_EXPENSE = 1_284_000; // 18,500 + 32,000 + 910,000 + 124,000 + 190,000 + 9,500

const pglite = new PGlite();
await pglite.exec(DDL);
await pglite.exec(`
  insert into "user" (id, name) values ('${U1}', 'Yoru'), ('${U2}', 'Big');
  insert into accounts (id, user_id, name) values
    ('${A1}', '${U1}', 'เงินสด'), ('${A2}', '${U1}', 'ธนาคาร'), ('${A_U2}', '${U2}', 'ของ u2');
  insert into categories (id, user_id, kind, name) values
    ('${C_FOOD}', '${U1}', 'expense', 'อาหาร'),
    ('${C_TRAVEL}', '${U1}', 'expense', 'เดินทาง'),
    ('${C_RENT}', '${U1}', 'expense', 'ค่าห้อง'),
    ('${C_SUPPLY}', '${U1}', 'expense', 'ของใช้'),
    ('${C_UTIL}', '${U1}', 'expense', 'ค่าน้ำค่าไฟ'),
    ('${C_COFFEE}', '${U1}', 'expense', 'กาแฟ'),
    ('${C_SALARY}', '${U1}', 'income', 'เงินเดือน'),
    ('${C_SALES}', '${U1}', 'income', 'ขายของ'),
    ('${C_U2E}', '${U2}', 'expense', 'ของ u2'),
    ('${C_U2I}', '${U2}', 'income', 'รับของ u2');

  -- u1 · กันยายน 2569 (live, รับ/จ่าย เท่านั้น)
  insert into transactions (user_id, kind, account_id, category_id, amount, occurred_at, note) values
    ('${U1}', 'expense', '${A1}', '${C_FOOD}',    18500, timestamptz '2026-09-13 10:00+07', 'ข้าวมันไก่'),
    ('${U1}', 'income',  '${A2}', '${C_SALARY}', 2250000, timestamptz '2026-09-13 09:00+07', 'เงินเดือน ก.ย.'),
    ('${U1}', 'expense', '${A1}', '${C_TRAVEL}',   32000, timestamptz '2026-09-12 08:30+07', 'BTS'),
    ('${U1}', 'expense', '${A1}', '${C_RENT}',    910000, timestamptz '2026-09-12 08:00+07', 'ค่าห้อง ก.ย.'),
    ('${U1}', 'expense', '${A1}', '${C_SUPPLY}',  124000, timestamptz '2026-09-11 19:00+07', null),
    ('${U1}', 'expense', '${A1}', '${C_UTIL}',    190000, timestamptz '2026-09-11 18:00+07', null),
    ('${U1}', 'income',  '${A1}', '${C_SALES}',   200000, timestamptz '2026-09-10 12:00+07', 'ขายของ'),
    ('${U1}', 'expense', '${A1}', '${C_COFFEE}',    9500, timestamptz '2026-09-10 07:00+07', 'กาแฟ');

  -- แถวที่ต้องถูกตัดออก: soft delete · transfer · เดือนอื่น · ของผู้ใช้อื่น
  insert into transactions (user_id, kind, account_id, category_id, amount, occurred_at, note)
    values ('${U1}', 'expense', '${A1}', '${C_FOOD}', 999999, timestamptz '2026-09-14 10:00+07', 'ถูกลบแล้ว');
  update transactions set deleted_at = now() where note = 'ถูกลบแล้ว';
  insert into transactions (user_id, kind, account_id, to_account_id, amount, occurred_at, note)
    values ('${U1}', 'transfer', '${A1}', '${A2}', 100000, timestamptz '2026-09-15 10:00+07', 'โอนเข้าแบงก์');
  insert into transactions (user_id, kind, account_id, category_id, amount, occurred_at, note)
    values ('${U1}', 'expense', '${A1}', '${C_FOOD}', 777000, timestamptz '2026-08-15 10:00+07', 'ของเดือน ส.ค.');
  insert into transactions (user_id, kind, account_id, category_id, amount, occurred_at, note) values
    ('${U2}', 'expense', '${A_U2}', '${C_U2E}', 500000, timestamptz '2026-09-12 10:00+07', 'ของ u2'),
    ('${U2}', 'income',  '${A_U2}', '${C_U2I}', 900000, timestamptz '2026-09-12 09:00+07', 'รับของ u2');
`);
await pglite.exec('vacuum analyze transactions');

// driver ของเทสต์เป็น pglite ส่วนแอปใช้ neon-http — query builder ตัวเดียวกัน SQL ที่ได้เหมือนกัน
// cast เฉพาะชนิด driver ตรงนี้ ไม่กระทบชนิดฝั่งแอป
const db = drizzle(pglite, { schema }) as unknown as Db;

test('ก) monthTotals = ค่าที่คิดมือ + = periodTotals ของแถวชุดเดียวกัน', async () => {
  const rows = await monthRows(db, U1, SEPT);
  assert.equal(rows.length, 8, 'u1 เดือน ก.ย. ต้องมี 8 แถวรับ/จ่ายที่ยังไม่ถูกลบ');

  const totals = await monthTotals(db, U1, SEPT);
  assert.deepEqual(totals, {
    income: SEPT_INCOME,
    expense: SEPT_EXPENSE,
    balance: SEPT_INCOME - SEPT_EXPENSE,
  });
  // สูตรเงินต้องมาจาก money.ts ตัวเดียว ไม่ใช่คำนวณซ้ำใน query layer
  assert.deepEqual(totals, periodTotals(rows));
});

test('ข) ไม่มีแถว/ยอดข้ามผู้ใช้หลุด', async () => {
  const rows = await monthRows(db, U1, SEPT);
  assert.ok(
    rows.every((row) => row.accountId === A1 || row.accountId === A2),
    'ทุกแถวของ u1 ต้องเป็นกระเป๋าของ u1',
  );
  assert.ok(
    rows.every((row) => row.amount !== 500000 && row.amount !== 900000),
    'ยอดของ u2 ต้องไม่โผล่ในชุดของ u1',
  );

  // ฝั่ง u2 ต้องเห็นของตัวเองครบ (พิสูจน์ว่า filter ทำงานจริง ไม่ใช่คืนค่าว่างเพราะเงื่อนไขพัง)
  assert.deepEqual(await monthTotals(db, U2, SEPT), { income: 900000, expense: 500000, balance: 400000 });
  assert.equal((await recentTransactions(db, U2, 10)).length, 2);
});

test('ค) แถว soft delete ไม่ถูกนับ (แต่ต้องมีอยู่จริงใน DB)', async () => {
  const raw = await pglite.query(`select count(*)::int as n from transactions where user_id = '${U1}' and deleted_at is not null`);
  assert.equal(raw.rows[0].n, 1, 'ต้องมีแถวที่ถูกลบอยู่ใน DB ไม่งั้นเทสต์นี้ผ่านแบบหลอก ๆ');

  const rows = await monthRows(db, U1, SEPT);
  assert.ok(
    rows.every((row) => row.deletedAt === null),
    'ทุกแถวที่ query คืนต้องยังไม่ถูกลบ',
  );
  assert.ok(
    rows.every((row) => row.amount !== 999999),
    'ยอดของแถวที่ลบแล้วต้องไม่ถูกนับ',
  );
  assert.equal((await monthTotals(db, U1, SEPT)).expense, SEPT_EXPENSE);
});

test('transfer ถูกตัดออกจากรายการรับ/จ่ายของเดือน (แต่ยังอยู่ในตาราง)', async () => {
  const raw = await pglite.query(`select count(*)::int as n from transactions where user_id = '${U1}' and kind = 'transfer'`);
  assert.equal(raw.rows[0].n, 1);

  const rows = await monthRows(db, U1, SEPT);
  assert.ok(
    rows.every((row) => row.kind !== 'transfer'),
    'transfer ไม่เป็นทั้งรับและจ่าย จึงต้องไม่อยู่ในชุดที่คิดยอด',
  );
});

test('expenseByCategory ของเดือน: รวมได้เท่ายอดจ่าย และแยกหมวดถูก', async () => {
  const byCat = await monthExpenseByCategory(db, U1, SEPT);
  assert.deepEqual(
    [...byCat.entries()].sort((a, b) => b[1] - a[1]),
    [
      [C_RENT, 910000],
      [C_UTIL, 190000],
      [C_SUPPLY, 124000],
      [C_TRAVEL, 32000],
      [C_FOOD, 18500],
      [C_COFFEE, 9500],
    ],
  );
  assert.equal([...byCat.values()].reduce((a, b) => a + b, 0), SEPT_EXPENSE);
});

test('หน้าแรก: เรียงใหม่->เก่า และ keyset ต่อหน้าไม่ซ้ำ/ไม่ข้าม', async () => {
  const page1 = await recentTransactions(db, U1, 3);
  assert.equal(page1.length, 3);
  const ids = page1.map((row) => row.id);
  assert.equal(new Set(ids).size, 3);

  const last = page1[page1.length - 1];
  const page2 = await recentTransactions(db, U1, 3, { occurredAt: last.occurredAt, id: last.id });
  assert.equal(page2.length, 3);
  assert.ok(
    page2.every((row) => !ids.includes(row.id)),
    'หน้าถัดไปต้องไม่ซ้ำกับหน้าแรก',
  );
  assert.ok(
    page2.every((row) => row.occurredAt.getTime() <= last.occurredAt.getTime()),
    'หน้าถัดไปต้องเก่ากว่าหรือเท่ากับแถวสุดท้ายของหน้าแรก',
  );

  // ไล่จนหมด: ทุกหน้าต่อกันด้วย keyset ต้องได้ครบทุกแถวของผู้ใช้คนนี้ (และไม่ซ้ำ)
  // recentTransactions ไม่กรองเดือน → นับจากตารางจริงของ u1 ที่ยังไม่ถูกลบ (9 ก.ย. + 1 ส.ค. + 1 transfer = 11)
  const raw = await pglite.query(`select count(*)::int as n from transactions where user_id = '${U1}' and deleted_at is null`);
  const expected = raw.rows[0].n;
  const all = [...page1, ...page2];
  let cursor = { occurredAt: page2[2].occurredAt, id: page2[2].id };
  for (let guard = 0; guard < 10; guard++) {
    const next = await recentTransactions(db, U1, 3, cursor);
    if (next.length === 0) break;
    all.push(...next);
    const tail = next[next.length - 1];
    cursor = { occurredAt: tail.occurredAt, id: tail.id };
  }
  assert.equal(all.length, expected, 'keyset ต้องเก็บได้ครบทุกแถวโดยไม่ซ้ำ/ไม่ข้าม');
  assert.equal(new Set(all.map((row) => row.id)).size, expected, 'ต้องไม่มี id ซ้ำข้ามหน้า');
  for (let i = 1; i < all.length; i++) {
    assert.ok(
      all[i - 1].occurredAt.getTime() >= all[i].occurredAt.getTime(),
      'ทั้งชุดต้องเรียงจากใหม่ไปเก่าต่อเนื่องกัน',
    );
  }
  assert.ok(
    all.every((row) => row.accountId === A1 || row.accountId === A2),
    'ไม่มีแถวของผู้ใช้อื่นปนมา',
  );
});

test('รายการทั้งหมด: filter kind/หมวด/เดือน + ค้นหา note', async () => {
  assert.equal((await listTransactions(db, U1, { periodMonth: SEPT, kind: 'expense' })).length, 6);
  assert.equal((await listTransactions(db, U1, { periodMonth: SEPT, kind: 'income' })).length, 2);

  const rent = await listTransactions(db, U1, { periodMonth: SEPT, categoryId: C_RENT });
  assert.equal(rent.length, 1);
  assert.equal(rent[0].amount, 910000);

  const searched = await listTransactions(db, U1, { search: 'ข้าว' });
  assert.equal(searched.length, 1);
  assert.equal(searched[0].categoryId, C_FOOD);

  const august = await listTransactions(db, U1, { periodMonth: AUG });
  assert.equal(august.length, 1);
  assert.equal(august[0].amount, 777000, 'เดือน ส.ค. แยกจาก ก.ย. ด้วย occurred_month_bkk');

  // ค้นหาต้องไม่ข้ามผู้ใช้: คำค้นเดียวกันในมุมของ u2 ต้องไม่ได้ของ u1
  assert.equal((await listTransactions(db, U2, { search: 'ข้าว' })).length, 0);
});

test('ง) query หน้าแรกใช้ index transactions_user_recent_idx และไม่ต้อง Sort', async () => {
  // ตารางเล็กมากในเทสต์ → planner เลือก seq scan ได้อย่างถูกต้องตามปกติ
  // ปิด seq scan เพื่อยืนยันว่า "index ตัวนี้ใช้กับ query นี้ได้จริง" (ไม่ได้พิสูจน์เรื่องความเร็วบนข้อมูลจริง)
  await pglite.exec('set enable_seqscan = off');
  const built = recentTransactionsQuery(db, U1, 20).toSQL();
  const plan = (
    await pglite.query<{ 'QUERY PLAN': string }>(`explain (costs off) ${built.sql}`, built.params as never[])
  ).rows.map((row) => row['QUERY PLAN']).join('\n');
  await pglite.exec('set enable_seqscan = on');

  assert.match(plan, /transactions_user_recent_idx/, `plan ต้องใช้ index หน้าแรก:\n${plan}`);
  assert.doesNotMatch(plan, /Sort/, `index ต้องเรียงให้แล้ว ไม่ต้อง Sort เพิ่ม:\n${plan}`);
});
