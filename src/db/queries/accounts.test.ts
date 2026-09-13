/**
 * เทสต์ query ของกระเป๋า: ยอดคงเหลือต่อกระเป๋า + จำนวนรายการที่อ้างถึง — PGlite (Postgres จริงใน WASM)
 * รัน: node --test src/db/queries/accounts.test.ts
 *
 * สูตรยอดคงเหลือ (นิยามเดียวกับ money.ts accountBalance — ที่นี่แค่ส่งข้อมูลเข้าไป):
 *   balance = initial_balance
 *           + income  ที่ account_id ตรง
 *           − expense ที่ account_id ตรง
 *           − transfer ที่ account_id ตรง (ต้นทาง) + transfer ที่ to_account_id ตรง (ปลายทาง)
 *   รายการที่ soft delete แล้วไม่ถูกนับ · ของผู้ใช้คนอื่นไม่ถูกนับ
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

import type { Db } from '../index.ts';
import * as schema from '../schema.ts';
import { accountBalances, accountUsage, lastUsedAccountId, listAccounts } from './accounts.ts';
import { addAccount, archiveAccount } from '../mutations/accounts.ts';
import { addCategory } from '../mutations/categories.ts';

const DDL = readFileSync(new URL('../../../docs/schema.sql', import.meta.url), 'utf8');

const U1 = 'u1';
const U2 = 'u2';
const C = (n: number) => `10000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const [C_FOOD, C_SALARY, C_U2I] = [1, 2, 3].map(C);
const A_CASH = '11111111-1111-1111-1111-111111111111';
const A_BANK = '22222222-2222-2222-2222-222222222222';
const A_CARD = '33333333-3333-3333-3333-333333333333';
const A_U2 = '44444444-4444-4444-4444-444444444444';

const pglite = new PGlite();
await pglite.exec(DDL);
await pglite.exec(`
  insert into "user" (id, name) values ('${U1}', 'Yoru'), ('${U2}', 'Big');
  insert into categories (id, user_id, kind, name) values
    ('${C_FOOD}', '${U1}', 'expense', 'อาหาร'),
    ('${C_SALARY}', '${U1}', 'income', 'เงินเดือน'),
    ('${C_U2I}', '${U2}', 'income', 'ของ u2');
  insert into accounts (id, user_id, name, kind, initial_balance) values
    ('${A_CASH}', '${U1}', 'เงินสด', 'cash', 100000),      -- 1,000.00
    ('${A_BANK}', '${U1}', 'ธนาคาร', 'bank', 0),
    ('${A_CARD}', '${U1}', 'บัตรเครดิต', 'credit', -250000), -- ยอดค้างจ่าย
    ('${A_U2}',   '${U2}', 'ของ u2', 'cash', 0);

  insert into transactions (user_id, kind, account_id, to_account_id, category_id, amount, occurred_at, note) values
    ('${U1}', 'income',  '${A_CASH}', null,       '${C_SALARY}',300000, timestamptz '2026-09-05 09:00+07', 'เงินเดือน'),
    ('${U1}', 'expense', '${A_CASH}', null,       '${C_FOOD}',128400, timestamptz '2026-09-06 12:00+07', 'ข้าว'),
    ('${U1}', 'transfer','${A_CASH}', '${A_BANK}', null,       100000, timestamptz '2026-09-07 10:00+07', 'โอนเข้าแบงก์'),
    ('${U1}', 'transfer','${A_BANK}', '${A_CASH}', null,        50000, timestamptz '2026-09-08 10:00+07', 'โอนกลับ'),
    ('${U1}', 'expense', '${A_BANK}', null,       '${C_FOOD}', 20000, timestamptz '2026-09-09 10:00+07', 'ค่าธรรมเนียม'),
    ('${U2}', 'income',  '${A_U2}',   null,       '${C_U2I}', 500000, timestamptz '2026-09-05 09:00+07', 'ของ u2');
  -- แถวที่ถูกลบต้องไม่ถูกนับ
  insert into transactions (user_id, kind, account_id, category_id, amount, occurred_at, note)
    values ('${U1}', 'expense', '${A_CASH}', '${C_FOOD}', 999999, timestamptz '2026-09-10 10:00+07', 'ถูกลบแล้ว');
  update transactions set deleted_at = now() where note = 'ถูกลบแล้ว';
`);

const db = drizzle(pglite, { schema }) as unknown as Db;

// นับ query จริงที่วิ่งเข้า PGlite (พิสูจน์ว่าไม่มี N+1)
let queryCount = 0;
const runQuery = pglite.query.bind(pglite);
pglite.query = ((...args: Parameters<typeof runQuery>) => {
  queryCount += 1;
  return runQuery(...args);
}) as typeof pglite.query;

test('ยอดคงเหลือต่อกระเป๋า: income เข้า · expense ออก · transfer ย้ายยอด · soft delete ไม่นับ', async () => {
  const balances = await accountBalances(db, U1);

  assert.equal(balances.get(A_CASH), 100_000 + 300_000 - 128_400 - 100_000 + 50_000, 'เงินสด');
  assert.equal(balances.get(A_BANK), 100_000 - 50_000 - 20_000, 'ธนาคาร');
  assert.equal(balances.get(A_CARD), -250_000, 'บัตรเครดิตติดลบได้ (ยอดค้างจ่าย)');

  // transfer = ย้ายยอด ไม่สร้าง/ทำลายเงิน → ผลรวมต้องเท่ากับ initial + รับ − จ่าย
  const total = [...balances.values()].reduce((sum, value) => sum + value, 0);
  assert.equal(total, (100_000 + 0 - 250_000) + 300_000 - 128_400 - 20_000);
  assert.equal(balances.has(A_U2), false, 'กระเป๋าของผู้ใช้คนอื่นต้องไม่หลุด');
});

test('ยอดคงเหลือ: 1 query ต่อการเรียก (ไม่ใช่ query ต่อกระเป๋า) และยังคืนกระเป๋าที่ archive แล้ว', async () => {
  queryCount = 0;
  const balances = await accountBalances(db, U1);
  assert.equal(balances.size, 3);
  assert.equal(queryCount, 1, 'ทุกกระเป๋าต้องมาจาก query เดียว');

  await archiveAccount(db, { userId: U1 }, A_CARD);
  assert.equal((await listAccounts(db, U1)).some((row) => row.id === A_CARD), false, 'หายจากลิสต์ active');
  const after = await accountBalances(db, U1);
  assert.equal(after.get(A_CARD), -250_000, 'กระเป๋าที่ archive ยังมียอดให้อ่าน (ประวัติยังอยู่)');
  assert.equal(after.size, 3);
});

test('กระเป๋าที่ไม่มีรายการเลย = initial_balance (ติดลบก็ได้) และไม่ปนข้อมูลผู้ใช้อื่น', async () => {
  const balances = await accountBalances(db, U1);
  assert.equal(balances.get(A_CARD), -250_000, 'บัตรเครดิตไม่มีรายการ = ยังเป็นยอดตั้งต้น (ติดลบ)');

  const u2 = await accountBalances(db, U2);
  assert.equal(u2.get(A_U2), 500_000, 'u2 เห็นเฉพาะยอดของตัวเอง');
  assert.equal(u2.size, 1, 'ไม่เห็นกระเป๋าของ u1');
});

test('จำนวนรายการที่อ้างถึงกระเป๋า: นับทั้งฝั่งต้นทางและปลายทางของโอน · ไม่นับที่ลบแล้ว · ข้ามผู้ใช้ไม่ได้', async () => {
  const usage = await accountUsage(db, U1, [A_CASH, A_BANK, A_CARD, A_U2]);

  assert.equal(usage.get(A_CASH), 4, 'รับ 1 + จ่าย 1 + โอนออก 1 + โอนเข้า 1 (แถวที่ลบแล้วไม่นับ)');
  assert.equal(usage.get(A_BANK), 3, 'โอนเข้า 1 + โอนออก 1 + จ่าย 1');
  assert.equal(usage.has(A_CARD), false, 'ยังไม่มีรายการอ้างถึง = ไม่มีคีย์ (ผู้เรียกอ่าน ?? 0)');
  assert.equal(usage.has(A_U2), false, 'กระเป๋าของผู้ใช้คนอื่นต้องไม่หลุด');

  queryCount = 0;
  const empty = await accountUsage(db, U1, []);
  assert.equal(empty.size, 0);
  assert.equal(queryCount, 0, 'ไม่มี id = ไม่ต้องยิง DB');

  queryCount = 0;
  await accountUsage(db, U1, [A_CASH, A_BANK]);
  assert.equal(queryCount, 1, 'ทุก id ต้องมาจาก query เดียว');
});

test('lastUsedAccountId: รายการล่าสุด (instant และ id เป็นตัวตัดสินเมื่อเวลาเท่ากัน) · soft delete ไม่ถูกนับ', async () => {
  // fixture: ล่าสุดที่ยังไม่ถูกลบ = จ่ายจากธนาคาร 2026-09-09 (แถวที่ลบแล้ว 2026-09-10 เป็นของเงินสด)
  assert.equal(await lastUsedAccountId(db, U1), A_BANK);

  // transfer ล่าสุด → ต้องได้ "ต้นทาง" (account_id) ตามที่ตัดสินไว้ (ปลายทางคือ A_BANK — ถ้าโค้ดคืน to_account_id เทสต์นี้จะแดง)
  await pglite.exec(`
    insert into transactions (user_id, kind, account_id, to_account_id, amount, occurred_at, note)
      values ('${U1}', 'transfer', '${A_CASH}', '${A_BANK}', 12345, timestamptz '2026-09-11 10:00+07', 'โอนล่าสุด');
  `);
  assert.equal(await lastUsedAccountId(db, U1), A_CASH, 'โอน = ใช้ต้นทางเป็นค่าเริ่มต้น');

  // เวลาเท่ากันเป๊ะ → ตัดสินด้วย id desc (แพตเทิร์นเดียวกับ keyset ของรายการ)
  await pglite.exec(`
    insert into transactions (user_id, kind, account_id, category_id, amount, occurred_at, note)
      values ('${U1}', 'expense', '${A_BANK}', '${C_FOOD}', 555, timestamptz '2026-09-11 10:00+07', 'เวลาเท่ากัน');
  `);
  const tied = await lastUsedAccountId(db, U1);
  assert.ok(tied === A_BANK || tied === A_CASH, 'เวลาเท่ากันต้องยังได้หนึ่งในสองแถว (ไม่ null)');
  const newest = await pglite.query<{ account_id: string }>(`
    select account_id from transactions where user_id = '${U1}' and deleted_at is null
    order by occurred_at desc, id desc limit 1`);
  assert.equal(tied, newest.rows[0].account_id, 'ต้องตรงกับกติกา (occurred_at desc, id desc)');

  // ของผู้ใช้คนอื่นไม่หลุด: u3 ไม่มีรายการเลย → null แม้ u1 จะมีเยอะ
  await pglite.exec(`insert into "user" (id, name) values ('u-empty', 'Empty');`);
  assert.equal(await lastUsedAccountId(db, 'u-empty'), null, 'ไม่มีรายการเลย = null');

  queryCount = 0;
  await lastUsedAccountId(db, U1);
  assert.equal(queryCount, 1, '1 query');
});

test('lastUsedAccountId ข้ามกระเป๋าที่ archive แล้ว (ค่าเริ่มต้นในชีตต้องบันทึกผ่าน)', async () => {
  const owner = { userId: 'u-last' };
  await pglite.exec(`insert into "user" (id, name) values ('${owner.userId}', 'Last');`);
  const older = await addAccount(db, owner, { name: 'ใบเก่า', kind: 'cash' });
  const newer = await addAccount(db, owner, { name: 'ใบใหม่', kind: 'bank' });
  // หมวดต้องเป็นของผู้ใช้คนนี้ (composite FK ผูก category_id + kind + user_id)
  const own = await addCategory(db, owner, { kind: 'expense', name: 'ของ u-last' });
  await pglite.exec(`
    insert into transactions (user_id, kind, account_id, category_id, amount, occurred_at, note) values
      ('${owner.userId}', 'expense', '${older.id}', '${own.id}', 100, timestamptz '2026-08-01 10:00+07', 'เก่า'),
      ('${owner.userId}', 'expense', '${newer.id}', '${own.id}', 200, timestamptz '2026-08-02 10:00+07', 'ใหม่');
  `);
  assert.equal(await lastUsedAccountId(db, owner.userId), newer.id, 'ปกติ = ใบที่ใช้ล่าสุด');

  await archiveAccount(db, owner, newer.id);
  assert.equal(
    await lastUsedAccountId(db, owner.userId),
    older.id,
    'ใบล่าสุดถูก archive → ข้ามไปใบก่อนหน้าที่ยังใช้งาน (ไม่คืนค่าที่บันทึกไม่ผ่าน)',
  );

  // archive ใบที่เหลือด้วย SQL ตรง ๆ — archiveAccount() ห้ามไว้ (กติกา wave9: ต้องเหลือ ≥1 ใบ)
  await pglite.exec(`update accounts set archived_at = now() where id = '${older.id}'`);
  assert.equal(await lastUsedAccountId(db, owner.userId), null, 'ไม่มีกระเป๋า active เหลือ = null');

  // ประสิทธิภาพ: query นี้ต้องใช้ index ล่าสุดของ transactions และไม่ต้อง Sort
  await pglite.exec('set enable_seqscan = off');
  const plan = (
    await pglite.query<{ 'QUERY PLAN': string }>(
      `explain (costs off) select t.account_id from transactions t
         join accounts a on a.id = t.account_id and a.user_id = t.user_id and a.archived_at is null
        where t.user_id = '${owner.userId}' and t.deleted_at is null
        order by t.occurred_at desc, t.id desc limit 1`,
    )
  ).rows.map((row) => row['QUERY PLAN']).join('\n');
  await pglite.exec('set enable_seqscan = on');
  assert.match(plan, /transactions_user_recent_idx/, `ต้องใช้ index ล่าสุด:\n${plan}`);
  assert.doesNotMatch(plan, /Sort/, `index เรียงให้แล้ว ไม่ต้อง Sort:\n${plan}`);
});
