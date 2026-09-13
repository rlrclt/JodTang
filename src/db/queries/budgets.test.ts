/**
 * เทสต์ query layer ของงบประมาณ — PGlite (Postgres จริงใน WASM)
 * รัน: node --test src/db/queries/budgets.test.ts
 *
 * apply DDL จาก docs/schema.sql ตรง ๆ (แหล่งความจริง) ไม่ใช่สำเนา
 * พิสูจน์ 5 ข้อ:
 *   ก) used ต่อหมวด = ผลรวม expense ของเดือนนั้น (ตัด deleted/เดือนอื่น/ผู้ใช้อื่น/transfer/income ออก)
 *   ข) used เท่ากับ monthExpenseByCategory() ของเดือนเดียวกันเป๊ะ (กติกา design §4: ตัวเลขต้องตรงกันทั้งแอป)
 *   ค) หมวดที่ถูก archive ยังโชว์ + ยังคิดยอด (ไม่งั้น /summary ขาดยอดเงียบ ๆ)
 *   ง) งบของผู้ใช้คนอื่นไม่หลุด
 *   จ) ไม่มี N+1: listBudgetProgress = 1 query เดียว
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

import type { Db } from '../index.ts';
import * as schema from '../schema.ts';
import { getBudget, listBudgetProgress } from './budgets.ts';
import { monthExpenseByCategory } from './transactions.ts';

const DDL = readFileSync(new URL('../../../docs/schema.sql', import.meta.url), 'utf8');

const U1 = 'u1';
const U2 = 'u2';
const A1 = '11111111-1111-1111-1111-111111111111';
const A2 = '22222222-2222-2222-2222-222222222222';
const A_U2 = '33333333-3333-3333-3333-333333333333';
const C = (n: number) => `10000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const [C_FOOD, C_TRAVEL, C_RENT, C_SALARY, C_U2E] = [1, 2, 3, 4, 5].map(C);

const SEPT = '2026-09-01';
const AUG = '2026-08-01';

const FOOD_BUDGET = 600_000;
const TRAVEL_BUDGET = 300_000;
const RENT_BUDGET = 950_000;

const pglite = new PGlite();
await pglite.exec(DDL);
await pglite.exec(`
  insert into "user" (id, name) values ('${U1}', 'Yoru'), ('${U2}', 'Big');
  insert into accounts (id, user_id, name) values
    ('${A1}', '${U1}', 'เงินสด'), ('${A2}', '${U1}', 'ธนาคาร'), ('${A_U2}', '${U2}', 'ของ u2');
  insert into categories (id, user_id, kind, name, icon, color, sort_order, archived_at) values
    ('${C_FOOD}',   '${U1}', 'expense', 'อาหาร',    'utensils', '--chart-6', 2, null),
    ('${C_TRAVEL}', '${U1}', 'expense', 'เดินทาง',  'bus',      '--chart-5', 1, null),
    ('${C_RENT}',   '${U1}', 'expense', 'ค่าห้อง',  'home',     '--chart-1', 3, now()),
    ('${C_SALARY}', '${U1}', 'income',  'เงินเดือน', null,      null,        0, null),
    ('${C_U2E}',    '${U2}', 'expense', 'ของ u2',   null,       null,        0, null);

  insert into budgets (user_id, category_id, period_month, amount) values
    ('${U1}', '${C_FOOD}',   '${SEPT}', ${FOOD_BUDGET}),
    ('${U1}', '${C_TRAVEL}', '${SEPT}', ${TRAVEL_BUDGET}),
    ('${U1}', '${C_RENT}',   '${SEPT}', ${RENT_BUDGET}),
    ('${U1}', '${C_FOOD}',   '${AUG}',  111111),
    ('${U2}', '${C_U2E}',    '${SEPT}', 123456);

  insert into transactions (user_id, kind, account_id, category_id, amount, occurred_at, note) values
    ('${U1}', 'expense', '${A1}', '${C_FOOD}',    18500, timestamptz '2026-09-13 10:00+07', 'ข้าวมันไก่'),
    ('${U1}', 'expense', '${A1}', '${C_FOOD}',    11500, timestamptz '2026-09-12 10:00+07', 'ก๋วยเตี๋ยว'),
    ('${U1}', 'expense', '${A1}', '${C_TRAVEL}',  32000, timestamptz '2026-09-12 08:30+07', 'BTS'),
    ('${U1}', 'expense', '${A1}', '${C_RENT}',   910000, timestamptz '2026-09-12 08:00+07', 'ค่าห้อง ก.ย.'),
    ('${U1}', 'income',  '${A1}', '${C_SALARY}',2250000, timestamptz '2026-09-13 09:00+07', 'เงินเดือน');
  -- แถวที่ต้องถูกตัดออกจาก used: soft delete · เดือนอื่น · ของผู้ใช้อื่น · transfer
  insert into transactions (user_id, kind, account_id, category_id, amount, occurred_at, note)
    values ('${U1}', 'expense', '${A1}', '${C_FOOD}', 999999, timestamptz '2026-09-14 10:00+07', 'ถูกลบแล้ว');
  update transactions set deleted_at = now() where note = 'ถูกลบแล้ว';
  insert into transactions (user_id, kind, account_id, category_id, amount, occurred_at, note)
    values ('${U1}', 'expense', '${A1}', '${C_FOOD}', 777000, timestamptz '2026-08-15 10:00+07', 'ของเดือน ส.ค.');
  insert into transactions (user_id, kind, account_id, category_id, amount, occurred_at, note)
    values ('${U2}', 'expense', '${A_U2}', '${C_U2E}', 500000, timestamptz '2026-09-12 10:00+07', 'ของ u2');
  insert into transactions (user_id, kind, account_id, to_account_id, amount, occurred_at, note)
    values ('${U1}', 'transfer', '${A1}', '${A2}', 100000, timestamptz '2026-09-15 10:00+07', 'โอน');
`);

// driver ของเทสต์เป็น pglite ส่วนแอปใช้ neon-http — query builder ตัวเดียวกัน SQL ที่ได้เหมือนกัน
const db = drizzle(pglite, { schema }) as unknown as Db;

// นับ query ที่วิ่งเข้า PGlite จริง (พิสูจน์ว่าไม่ใช่ N+1) — patch ที่ instance ไม่ใช่ที่ drizzle
let queryCount = 0;
const runQuery = pglite.query.bind(pglite);
pglite.query = ((...args: Parameters<typeof runQuery>) => {
  queryCount += 1;
  return runQuery(...args);
}) as typeof pglite.query;

test('ก) used ต่อหมวด = ผลรวม expense ของเดือนนั้น (ตัด deleted/เดือนอื่น/ผู้ใช้อื่น/transfer)', async () => {
  const rows = await listBudgetProgress(db, U1, SEPT);

  assert.deepEqual(
    rows.map((row) => [row.categoryName, row.used]),
    [
      ['เดินทาง', 32_000],
      ['อาหาร', 30_000],
      ['ค่าห้อง', 910_000],
    ],
  );
  assert.deepEqual(
    rows.map((row) => row.amount),
    [TRAVEL_BUDGET, FOOD_BUDGET, RENT_BUDGET],
  );
});

test('ข) used เท่ากับ monthExpenseByCategory ของเดือนเดียวกันเป๊ะ (ตัวเลขต้องตรงกันทั้งแอป)', async () => {
  const byCategory = await monthExpenseByCategory(db, U1, SEPT);
  for (const row of await listBudgetProgress(db, U1, SEPT)) {
    assert.equal(row.used, byCategory.get(row.categoryId), `ยอดของ ${row.categoryName} ต้องตรงกับ /summary`);
  }
});

test('ค) หมวดที่ archive แล้วยังโชว์ + ยังคิดยอด (เรียงไว้ท้าย) และเปิด sheet แก้ได้', async () => {
  const rows = await listBudgetProgress(db, U1, SEPT);
  const rent = rows.find((row) => row.categoryId === C_RENT);

  assert.ok(rent, 'งบของหมวดที่ archive ต้องยังอยู่ในลิสต์');
  assert.ok(rent.categoryArchivedAt instanceof Date, 'ต้องส่ง archivedAt ให้ UI ติดป้าย "เลิกใช้แล้ว"');
  assert.equal(rows[rows.length - 1].categoryId, C_RENT, 'หมวด archived ต้องอยู่ท้ายลิสต์');
});

test('ง) งบ/ยอดของผู้ใช้คนอื่นไม่หลุด และงบของเดือนอื่นไม่ปน', async () => {
  const rows = await listBudgetProgress(db, U1, SEPT);

  assert.equal(rows.length, 3, 'เห็นเฉพาะ 3 งบของ u1 ในเดือน ก.ย.');
  assert.ok(
    rows.every((row) => row.periodMonth === SEPT),
    'งบเดือน ส.ค. ต้องไม่โผล่',
  );
  assert.equal((await listBudgetProgress(db, U2, SEPT)).map((row) => row.used)[0], 500_000, 'u2 เห็นของตัวเอง');
  assert.deepEqual(
    await listBudgetProgress(db, U1, '2026-10-01'),
    [],
    'เดือนที่ยังไม่ตั้งงบ = ลิสต์ว่าง ไม่ใช่ error',
  );
});

test('จ) listBudgetProgress ยิง query เดียว (ไม่มี N+1)', async () => {
  queryCount = 0;
  const rows = await listBudgetProgress(db, U1, SEPT);

  assert.equal(rows.length, 3);
  assert.equal(queryCount, 1, 'งบทั้งหน้า + ยอดที่ใช้ ต้องมาจาก query เดียว');
});

test('getBudget คืนงบของเดือนนั้น · ไม่มี = null · ไม่ใช่ของเรา = null', async () => {
  const sept = await getBudget(db, U1, C_FOOD, SEPT);
  assert.equal(sept?.amount, FOOD_BUDGET);
  assert.equal(sept?.periodMonth, SEPT);

  assert.equal(await getBudget(db, U1, C_FOOD, '2026-10-01'), null, 'เดือนที่ยังไม่ตั้ง = null');
  assert.equal(await getBudget(db, U1, C_U2E, SEPT), null, 'หมวดของผู้ใช้คนอื่น = null');
  assert.equal(await getBudget(db, U2, C_FOOD, SEPT), null, 'งบของ u1 ต้องไม่หลุดให้ u2');
});
