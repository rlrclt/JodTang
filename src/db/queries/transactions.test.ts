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

import { periodMonthFromParam } from '../../lib/month.ts';
import { periodTotals } from '../../lib/money.ts';
import type { Db } from '../index.ts';
import * as schema from '../schema.ts';
import {
  listTransactionPage,
  loadEntryForEdit,
  monthExpenseByCategory,
  monthRows,
  monthTotals,
  transactionPageQuery,
  trendByMonth,
} from './transactions.ts';

const DDL = readFileSync(new URL('../../../docs/schema.sql', import.meta.url), 'utf8');

const U1 = 'u1';
const U2 = 'u2';
const A1 = '11111111-1111-1111-1111-111111111111';
const A2 = '22222222-2222-2222-2222-222222222222';
const A_U2 = '33333333-3333-3333-3333-333333333333';
const C = (n: number) => `10000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const [C_FOOD, C_TRAVEL, C_RENT, C_SUPPLY, C_UTIL, C_COFFEE, C_SALARY, C_SALES, C_U2E, C_U2I] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(C);

const C_MISSING = '99999999-9999-9999-9999-999999999999';
const SEPT = '2026-09-01';
const OCT = '2026-10-01';
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

  -- กลุ่มเวลาเท่ากันเป๊ะ (keyset tie-break: 4+3+1 แถว) — 2 แถวเท่ากันไม่พอจะแยก tie branch ออกจากบั๊ก
  insert into transactions (user_id, kind, account_id, category_id, amount, occurred_at, note) values
    ('${U1}', 'expense', '${A1}', '${C_FOOD}', 1001, timestamptz '2026-10-05 09:00+07', 'tie-A'),
    ('${U1}', 'expense', '${A1}', '${C_FOOD}', 1002, timestamptz '2026-10-05 09:00+07', 'tie-A'),
    ('${U1}', 'expense', '${A1}', '${C_FOOD}', 1003, timestamptz '2026-10-05 09:00+07', 'tie-A'),
    ('${U1}', 'expense', '${A1}', '${C_FOOD}', 1004, timestamptz '2026-10-05 09:00+07', 'tie-A'),
    ('${U1}', 'expense', '${A1}', '${C_FOOD}', 2001, timestamptz '2026-10-04 09:00+07', 'tie-B'),
    ('${U1}', 'expense', '${A1}', '${C_FOOD}', 2002, timestamptz '2026-10-04 09:00+07', 'tie-B'),
    ('${U1}', 'expense', '${A1}', '${C_FOOD}', 2003, timestamptz '2026-10-04 09:00+07', 'tie-B'),
    ('${U1}', 'expense', '${A1}', '${C_FOOD}', 3001, timestamptz '2026-10-03 09:00+07', 'tie-C');

  -- note ที่มีอักขระพิเศษของ LIKE (ทดสอบ escape): 'กาแฟ ลด 50%' · 'a_b' · 'axb'
  insert into transactions (user_id, kind, account_id, category_id, amount, occurred_at, note) values
    ('${U1}', 'expense', '${A1}', '${C_FOOD}', 5000, timestamptz '2026-10-06 09:00+07', 'กาแฟ ลด 50%'),
    ('${U1}', 'expense', '${A1}', '${C_FOOD}', 6000, timestamptz '2026-10-06 09:00+07', 'a_b'),
    ('${U1}', 'expense', '${A1}', '${C_FOOD}', 7000, timestamptz '2026-10-06 09:00+07', 'axb');
`);
await pglite.exec('vacuum analyze transactions');

// driver ของเทสต์เป็น pglite ส่วนแอปใช้ neon-http — query builder ตัวเดียวกัน SQL ที่ได้เหมือนกัน
// cast เฉพาะชนิด driver ตรงนี้ ไม่กระทบชนิดฝั่งแอป
const db = drizzle(pglite, { schema }) as unknown as Db;

// นับ query จริงที่วิ่งเข้า PGlite (พิสูจน์ว่าแนวโน้ม 6 เดือน = 1 query)
let queryCount = 0;
const runQuery = pglite.query.bind(pglite);
pglite.query = ((...args: Parameters<typeof runQuery>) => {
  queryCount += 1;
  return runQuery(...args);
}) as typeof pglite.query;

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
  assert.equal((await listTransactionPage(db, U2, { limit: 10 })).total, 2);
});

test('ค) แถว soft delete ไม่ถูกนับ (แต่ต้องมีอยู่จริงใน DB)', async () => {
  const raw = await pglite.query<{ n: number }>(`select count(*)::int as n from transactions where user_id = '${U1}' and deleted_at is not null`);
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
  const raw = await pglite.query<{ n: number }>(`select count(*)::int as n from transactions where user_id = '${U1}' and kind = 'transfer'`);
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

test('แนวโน้ม 6 เดือน: เก่า→ใหม่ · เดือนว่างได้ 0 · ตรงกับ monthTotals ของเดือนนั้นเป๊ะ', async () => {
  const trend = await trendByMonth(db, U1, OCT, 6);

  assert.deepEqual(
    trend.map((row) => row.periodMonth),
    ['2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01'],
    'ต้องครบ 6 เดือนเรียงเก่า→ใหม่ และลงท้ายที่เดือนที่ขอ',
  );

  // ทุกเดือนต้องเท่ากับ monthTotals() ของเดือนนั้น (สูตรเงินอยู่ money.ts ที่เดียว — ห้ามมีสูตรที่สอง)
  for (const month of trend) {
    assert.deepEqual(
      { income: month.income, expense: month.expense, balance: month.balance },
      await monthTotals(db, U1, month.periodMonth),
      `ยอดของ ${month.periodMonth} ต้องตรงกับ monthTotals`,
    );
  }

  const emptyMonths = trend.filter((month) => month.income === 0 && month.expense === 0);
  assert.ok(emptyMonths.length >= 2, 'เดือนที่ไม่มีข้อมูลต้องได้ 0 ไม่ใช่ขาดแถว');
  assert.ok(
    trend.every((month) => Number.isSafeInteger(month.balance)),
    'ยอดคงเหลือต้องเป็นสตางค์จำนวนเต็ม',
  );
  assert.ok(trend.some((month) => month.expense > 0), 'ต้องมีเดือนที่มีข้อมูลจริง (ไม่งั้นเทสต์ผ่านแบบหลอก ๆ)');
});

test('แนวโน้ม: 1 query เท่านั้น (ไม่ใช่ 6) และไม่ปนข้อมูลผู้ใช้อื่น', async () => {
  queryCount = 0;
  const u1Trend = await trendByMonth(db, U1, OCT, 6);
  assert.equal(queryCount, 1, 'ทั้ง 6 เดือนต้องมาจาก query เดียว');

  const u2Trend = await trendByMonth(db, U2, OCT, 6);
  assert.notDeepEqual(
    u2Trend.find((month) => month.periodMonth === SEPT),
    u1Trend.find((month) => month.periodMonth === SEPT),
    'ยอดของ u2 กับ u1 ต้องไม่เหมือนกัน (พิสูจน์ว่าไม่ได้อ่านข้ามผู้ใช้)',
  );
  const u2September = u2Trend.find((month) => month.periodMonth === SEPT);
  assert.deepEqual(
    { income: u2September?.income, expense: u2September?.expense, balance: u2September?.balance },
    await monthTotals(db, U2, SEPT),
    'ยอดของ u2 ในแนวโน้มต้องเท่ากับ monthTotals ของ u2',
  );

  await assert.rejects(trendByMonth(db, U1, OCT, 0), TypeError, 'months ต้อง ≥ 1');
  await assert.rejects(trendByMonth(db, U1, '2026-10-15', 6), TypeError, 'งวดเดือนต้องเป็นวันแรกของเดือน');
});

test('ค่าดิบจาก ?m= ต้องไม่ทำให้ trend พัง (เคสรีวิว: ?m=0000-01-01)', async () => {
  // เส้นทางจริงของหน้าเว็บ: ?m= → periodMonthFromParam() → trendByMonth()
  for (const raw of ['0000-01-01', '9999-12-01', '10000-01-01', 'abc', '', null]) {
    const trend = await trendByMonth(db, U1, periodMonthFromParam(raw), 6);
    assert.equal(trend.length, 6, `ต้องได้ 6 งวดสำหรับ ${JSON.stringify(raw)}`);
    assert.ok(
      trend.every((month) => /^\d{4}-(0[1-9]|1[0-2])-01$/.test(month.periodMonth)),
      `งวดเดือนต้องเป็น 'YYYY-MM-01' ที่ PG รับได้ (${JSON.stringify(raw)})`,
    );
  }
  // และงวดสุดขอบที่รับได้ ต้องยัง query ได้จริง (ไม่ throw)
  assert.equal((await trendByMonth(db, U1, periodMonthFromParam('9999-12-01'), 6)).length, 6);

  // ถ้ามีใครส่งค่าดิบข้ามชั้น param ไปตรง ๆ ต้องได้ TypeError ชัด ๆ ไม่ใช่ PG error ที่อ่านไม่ออก
  await assert.rejects(trendByMonth(db, U1, '0000-01-01', 6), TypeError);
});

test('ง) query ของหน้ารายการใช้ index (ไม่ Seq Scan) และเส้น "ล่าสุด N แถว" เรียงให้แล้ว ไม่ต้อง Sort', async () => {
  // ตารางเล็กมากในเทสต์ → planner เลือก seq scan ได้อย่างถูกต้องตามปกติ
  // ปิด seq scan เพื่อยืนยันว่า "index ตัวนี้ใช้กับ query นี้ได้จริง" (ไม่ได้พิสูจน์เรื่องความเร็วบนข้อมูลจริง)
  const planFor = async (filters: Parameters<typeof transactionPageQuery>[2]) => {
    const built = transactionPageQuery(db, U1, filters).toSQL();
    return (
      await pglite.query<{ 'QUERY PLAN': string }>(`explain (costs off) ${built.sql}`, built.params as never[])
    ).rows
      .map((row) => row['QUERY PLAN'])
      .join('\n');
  };

  await pglite.exec('set enable_seqscan = off');
  // (1) ไม่กรองเดือน = "ล่าสุด N แถว" → transactions_user_recent_idx เรียงให้แล้ว (ไม่ต้อง Sort)
  const latest = await planFor({ limit: 20 });
  // (2) กรองเดือน (เส้นที่หน้าแรก/รายการใช้จริง) → ต้องมี index อย่างน้อย 1 ตัว ไม่ใช่ Seq Scan
  const monthPage = await planFor({ periodMonth: SEPT, limit: 20 });
  await pglite.exec('set enable_seqscan = on');

  assert.match(latest, /transactions_user_recent_idx/, `plan ต้องใช้ index ล่าสุด:\n${latest}`);
  assert.doesNotMatch(latest, /Sort/, `index ต้องเรียงให้แล้ว ไม่ต้อง Sort เพิ่ม:\n${latest}`);
  assert.match(monthPage, /transactions_user_(recent|month)_idx/, `หน้าต้องกรองด้วย index:\n${monthPage}`);
  assert.doesNotMatch(monthPage, /Seq Scan/, `ห้ามตกเป็น Seq Scan:\n${monthPage}`);
});

test('loadEntryForEdit: ของตัวเองได้แถวครบ · ของคนอื่น/ที่ลบแล้ว/ไม่มีจริง = null · 1 query', async () => {
  const mine = await monthRows(db, U1, SEPT);
  const target = mine[0];

  const loaded = await loadEntryForEdit(db, U1, target.id);
  assert.ok(loaded, 'ของตัวเองต้องโหลดได้');
  assert.equal(loaded.id, target.id);
  assert.equal(loaded.amount, target.amount);
  assert.equal(loaded.kind, target.kind);
  assert.equal(loaded.accountId, target.accountId);
  assert.equal(loaded.categoryId, target.categoryId);
  assert.equal(loaded.deletedAt, null);
  assert.ok(loaded.occurredAt instanceof Date, 'occurredAt ต้องเป็น Date ให้ฟอร์มแก้ใช้ได้');
  assert.equal(typeof loaded.note === 'string' || loaded.note === null, true, 'note ต้องมีให้ฟอร์ม prefill');

  // ของผู้ใช้คนอื่น
  const u2Row = (await monthRows(db, U2, SEPT))[0];
  assert.equal(await loadEntryForEdit(db, U1, u2Row.id), null, 'ของ u2 ต้องไม่หลุดให้ u1');
  assert.ok(await loadEntryForEdit(db, U2, u2Row.id), 'u2 เห็นของตัวเอง');

  // ที่ถูกลบแล้ว (fixture มีแถว soft delete อยู่จริง — ยืนยันก่อนว่าไม่มีในผลลัพธ์)
  const deleted = await pglite.query<{ id: string }>(
    `select id from transactions where user_id = '${U1}' and deleted_at is not null limit 1`,
  );
  assert.equal(deleted.rows.length, 1, 'fixture ต้องมีแถวที่ถูกลบ ไม่งั้นเทสต์นี้พิสูจน์อะไรไม่ได้');
  assert.equal(await loadEntryForEdit(db, U1, deleted.rows[0].id), null, 'แถวที่ถูกลบแล้ว = null');

  // id ที่ไม่มีในตาราง
  assert.equal(await loadEntryForEdit(db, U1, C_MISSING), null);

  // แถวที่มีโน้ตจริง (fixture: 'ข้าวมันไก่') — ฟอร์มแก้ต้อง prefill ได้
  const withNote = mine.find((row) => row.amount === 18_500);
  assert.ok(withNote);
  const loadedNote = await loadEntryForEdit(db, U1, withNote.id);
  assert.equal(loadedNote?.note, 'ข้าวมันไก่');

  queryCount = 0;
  await loadEntryForEdit(db, U1, target.id);
  assert.equal(queryCount, 1, '1 query');
});
